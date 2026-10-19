import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from app.youtube import caption_rows, video_id_from_url, CaptionError
from app.main import import_youtube, YouTubeInput, state, AskInput, ask
from app.storage import MemoryStore
from app.embeddings import feature_embedding
from app.providers import LLMProvider
from app.config import Settings
from app.retrieval import Retriever


class LocalEmbedding:
    async def embed(self, text):
        return feature_embedding(text)


class YouTubeTests(unittest.IsolatedAsyncioTestCase):
    def test_urls_reject_non_youtube_and_playlist(self):
        for url in ['https://youtu.be/mx3J9wdbJ30', 'https://www.youtube.com/watch?v=mx3J9wdbJ30&list=abc', 'https://youtube.com/shorts/mx3J9wdbJ30']:
            self.assertEqual(video_id_from_url(url), 'mx3J9wdbJ30')
        for url in ['http://localhost/private', 'https://youtube.com.evil.com/watch?v=mx3J9wdbJ30', 'https://youtube.com/playlist?list=x', 'file:///tmp/test', 'https://user:password@youtube.com/watch?v=mx3J9wdbJ30']:
            with self.assertRaises(CaptionError):
                video_id_from_url(url)

    def test_fractional_cue_ends_round_up_and_groups_stay_bounded(self):
        rows = caption_rows([SimpleNamespace(start=0.2, duration=4.1, text='Transformer definition.'), SimpleNamespace(start=4.3, duration=6.2, text='Energy transfer.'), SimpleNamespace(start=30.1, duration=5.2, text='Later section.')])
        self.assertEqual(rows[0], {'start': 0, 'end': 11, 'text': 'Transformer definition. Energy transfer.'})
        self.assertEqual(rows[1]['end'], 36)

    async def test_import_is_separate_cached_and_time_filtered(self):
        store = MemoryStore()
        sample = await store.add_course('RAG sample')
        item = {'title':'Transformer lesson', 'video_url':'https://www.youtube.com/watch?v=mx3J9wdbJ30', 'language':'English', 'generated':True,
                'rows':[{'start':0, 'end':11, 'text':'A transformer transfers electrical energy between circuits.'}, {'start':20, 'end':30, 'text':'Secret future voltage details.'}]}
        with patch('app.main.fetch_captions', return_value=item) as fetch, patch.object(state, 'embedder', LocalEmbedding()), patch.object(state, 'retriever', Retriever(store, LocalEmbedding())), patch.object(state, 'llm', LLMProvider(Settings(llm_provider='mock'))):
            result = await import_youtube(YouTubeInput(url=item['video_url']), store)
            course = result['course']
            self.assertNotEqual(course['id'], sample['id'])
            again = await import_youtube(YouTubeInput(url='https://youtu.be/mx3J9wdbJ30'), store)
            self.assertTrue(again['cached'])
            self.assertEqual(fetch.call_count,1)
            answer = await ask(AskInput(course_id=course['id'], question='What is this lesson about?', video_time_seconds=11), store)
            self.assertIn('electrical energy',answer['answer'])
            self.assertNotIn('Secret future',answer['answer'])
            self.assertNotIn('retrieval',answer['answer'])
            empty = await ask(AskInput(course_id=course['id'], question='What is this lesson about?', video_time_seconds=0),store)
            self.assertEqual(empty['citations'],[])
            quiz = await ask(AskInput(course_id=course['id'], question='Quiz me', action='quiz', video_time_seconds=11),store)
            self.assertNotIn('Semantic vectors',quiz['answer'])

    async def test_failure_does_not_create_course_or_fall_back(self):
        store = MemoryStore()
        await store.add_course('RAG sample')
        with patch('app.main.fetch_captions', side_effect=CaptionError('Captions unavailable')), patch('app.main.settings.gemini_api_key', None):
            with self.assertRaises(HTTPException) as error:
                await import_youtube(YouTubeInput(url='https://youtu.be/mx3J9wdbJ30'),store)
            self.assertEqual(error.exception.status_code,422)
            self.assertEqual(len(await store.list_courses()),1)
