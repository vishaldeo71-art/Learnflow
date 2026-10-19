import unittest
from unittest.mock import patch

from app.config import Settings
from app.domain import Chunk
from app.embeddings import feature_embedding
from app.main import AskInput, ask, state
from app.providers import LLMProvider
from app.retrieval import Retriever, is_overview_question
from app.storage import MemoryStore


class LocalEmbedding:
    async def embed(self, text):
        return feature_embedding(text)


class OverviewTests(unittest.IsolatedAsyncioTestCase):
    async def test_overview_answers_from_covered_material_and_excludes_future(self):
        store = MemoryStore()
        course = await store.add_course("RAG Foundations")
        for identifier, end, text in (("past", 75, "Retrieval augmented generation finds relevant passages before writing an answer."), ("future", 1145, "Secret future reranking details.")):
            store.chunks[course["id"]].append(Chunk(id=identifier, course_id=course["id"], resource_id="lecture", resource_name="lesson.vtt", source_type="video", content=text, embedding=feature_embedding(text), start_time=end-50, end_time=end))
        with patch.object(state, "retriever", Retriever(store, LocalEmbedding())), patch.object(state, "llm", LLMProvider(Settings(llm_provider="mock"))):
            result = await ask(AskInput(course_id=course["id"], question="What is this lesson about?", video_time_seconds=1125), store)
            self.assertIsNone(result["refusal_reason"])
            self.assertTrue(result["citations"])
            self.assertIn("Retrieval augmented generation", result["answer"])
            self.assertTrue(result["answer"].startswith("Here's a short recap"))
            self.assertNotIn("Secret future", result["answer"])
            self.assertEqual(result["retrieved_chunks"], 1)
            empty = await ask(AskInput(course_id=course["id"], question="What is this lesson about?", video_time_seconds=0), store)
            self.assertEqual(empty["citations"], [])

    def test_specific_and_unsupported_questions_are_not_treated_as_overviews(self):
        self.assertTrue(is_overview_question("What is this lesson about?"))
        self.assertTrue(is_overview_question("Give me an overview of this lecture."))
        self.assertFalse(is_overview_question("What is reranking?"))
        self.assertFalse(is_overview_question("What is the capital of Antarctica?"))
