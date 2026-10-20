import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app.config import Settings
from app.embeddings import feature_embedding
from app.main import AskInput, YouTubeInput, ask, import_youtube, state
from app.providers import LLMProvider
from app.retrieval import Retriever, citation_for
from app.storage import MemoryStore
from app.video_notes import VIDEO_NOTES_DESCRIPTION, generate_video_notes, notes_clip_bounds, notes_resource_name
from app.youtube import CaptionError

URL = "https://www.youtube.com/watch?v=UrsmFxEIp5k"


class LocalEmbedding:
    async def embed(self, text):
        return feature_embedding(text)


class VideoNotesTests(unittest.IsolatedAsyncioTestCase):
    async def test_blocked_captions_fall_back_and_then_use_cache(self):
        store = MemoryStore()
        notes = {"title": "Python lesson", "language": "AI video notes", "generated": True, "source": "gemini_video",
                 "rows": [{"start": 0, "end": 60, "text": "The speaker introduces learning Python."}]}
        with patch("app.main.fetch_captions", side_effect=CaptionError("blocked")), \
             patch("app.main.settings.gemini_api_key", "test-key"), \
             patch("app.main.fetch_video_title", return_value="Spanish Python lesson"), \
             patch("app.main.generate_video_notes", new=AsyncMock(return_value=notes)) as generate, \
             patch.object(state, "embedder", LocalEmbedding()):
            first = await import_youtube(YouTubeInput(url=URL), store)
            self.assertEqual(first["source"], "gemini_video")
            self.assertTrue(first["course"]["description"].startswith(VIDEO_NOTES_DESCRIPTION))
            cached = await import_youtube(YouTubeInput(url=URL), store)
            self.assertTrue(cached["cached"])
            self.assertEqual(cached["source"], "gemini_video")
            self.assertEqual(first["status"], "awaiting_analysis")
            self.assertEqual(first["chunk_count"], 0)
            generate.assert_not_awaited()

    async def test_long_foreign_transcript_uses_on_demand_analysis_without_bulk_embeddings(self):
        store = MemoryStore()
        imported = {"title": "Spanish lecture", "language": "Spanish", "generated": True,
                    "rows": [{"start": i*20, "end": i*20+20, "text": "Las variables almacenan valores en Python."} for i in range(65)]}
        embedder = SimpleNamespace(embed=AsyncMock(side_effect=AssertionError("No full-lecture indexing")))
        with patch("app.main.fetch_captions", return_value=imported), \
             patch("app.main.fetch_video_title", return_value="Spanish lecture"), \
             patch("app.main.settings.gemini_api_key", "test-key"), \
             patch.object(state, "embedder", embedder):
            result = await import_youtube(YouTubeInput(url=URL), store)
            self.assertEqual(result["source"], "gemini_video")
            self.assertEqual(result["status"], "awaiting_analysis")
            embedder.embed.assert_not_awaited()

    async def test_missing_analysis_key_does_not_publish_a_course(self):
        store = MemoryStore()
        with patch("app.main.fetch_captions", side_effect=CaptionError("blocked")), \
             patch("app.main.settings.gemini_api_key", None), \
             patch("app.main.generate_video_notes", new=AsyncMock(side_effect=CaptionError("unavailable"))):
            with self.assertRaises(HTTPException) as error:
                await import_youtube(YouTubeInput(url=URL), store)
            self.assertEqual(error.exception.status_code, 422)
            self.assertEqual(await store.list_courses(), [])

    async def test_question_analyzes_only_watched_clip_and_reuses_it(self):
        store = MemoryStore()
        course = await store.add_course("Python", VIDEO_NOTES_DESCRIPTION, URL)
        notes = {"rows": [{"start": 300, "end": 600, "text": "Python variables bind names to values."}]}
        with patch("app.main.generate_video_notes", new=AsyncMock(return_value=notes)) as generate, \
             patch.object(state, "embedder", LocalEmbedding()), \
             patch.object(state, "retriever", Retriever(store, LocalEmbedding())), \
             patch.object(state, "llm", LLMProvider(Settings(llm_provider="mock"))):
            first = await ask(AskInput(course_id=course["id"], question="Summarize so far", action="summary", video_time_seconds=600), store)
            generate.assert_awaited_once()
            self.assertEqual(generate.await_args.args[:3], (URL, 300, 600))
            self.assertTrue(all(chunk.end_time <= 600 for chunk in store.chunks[course["id"]]))
            self.assertIn("AI video notes", first["citations"][0]["label"])
            await ask(AskInput(course_id=course["id"], question="Explain Python variables", video_time_seconds=600), store)
            generate.assert_awaited_once()
            await ask(AskInput(course_id=course["id"], question="Explain Python variables", video_time_seconds=610), store)
            generate.assert_awaited_once()
            earlier = await store.covered_chunks(course["id"], 599)
            self.assertEqual(earlier, [])

    async def test_invalid_session_does_not_trigger_video_analysis(self):
        store = MemoryStore()
        course = await store.add_course("Python", VIDEO_NOTES_DESCRIPTION, URL)
        with patch("app.main.generate_video_notes", new=AsyncMock()) as generate:
            with self.assertRaises(HTTPException):
                await ask(AskInput(course_id=course["id"], session_id="unknown", question="Explain", video_time_seconds=300), store)
            generate.assert_not_awaited()

    def test_analysis_windows_are_stable_and_never_extend_past_playhead(self):
        for position in (1, 29, 30, 599, 600, 610, 86400):
            start, end = notes_clip_bounds(position)
            self.assertTrue(0 <= start < end <= position)
            self.assertLessEqual(end - start, 300)
        self.assertEqual(notes_clip_bounds(610), notes_clip_bounds(600))

    async def test_analysis_failure_preserves_attached_course_for_retry(self):
        store = MemoryStore()
        course = await store.add_course("French lesson", VIDEO_NOTES_DESCRIPTION, URL)
        with patch("app.main.generate_video_notes", new=AsyncMock(side_effect=CaptionError("Temporarily unavailable"))):
            with self.assertRaises(HTTPException) as error:
                await ask(AskInput(course_id=course["id"], question="Summarize", action="summary", video_time_seconds=120), store)
            self.assertEqual(error.exception.status_code, 503)
            self.assertIsNotNone(await store.get_course(course["id"]))
            self.assertEqual(store.chunks[course["id"]], [])

    async def test_clip_bounds_are_validated_before_external_request(self):
        settings = Settings(gemini_api_key="test-key")
        for start, end in [(-1, 10), (0, 301), (5, 5), (86300, 86500)]:
            with self.assertRaises(CaptionError):
                await generate_video_notes(URL, start, end, settings)

    async def test_model_notes_inherit_clip_bounds_and_inaccessible_video_is_rejected(self):
        from google import genai

        client = MagicMock()
        client.models.generate_content.return_value = SimpleNamespace(text='{"available":true,"title":"Variables en français","language":"French","notes":["Variables store values."]}')
        with patch.object(genai, "Client", return_value=client):
            notes = await generate_video_notes(URL, 10, 30, Settings(gemini_api_key="test-key"))
            self.assertEqual((notes["rows"][0]["start"], notes["rows"][0]["end"]), (10, 30))
            self.assertEqual(notes["language"], "French")
            request = client.models.generate_content.call_args.kwargs
            self.assertIn("Automatically identify the spoken language", request["contents"].parts[1].text)
            client.close.assert_called_once()
            client.models.generate_content.return_value = SimpleNamespace(text='{"available":false,"title":"","notes":[]}')
            with self.assertRaises(CaptionError):
                await generate_video_notes(URL, 10, 30, Settings(gemini_api_key="test-key"))


if __name__ == "__main__":
    unittest.main()
