import unittest
from types import SimpleNamespace
from unittest.mock import patch
from app.domain import Chunk
from app.embeddings import feature_embedding
from app.retrieval import Retriever
from app.source_quality import informative, caption_quality
from app.storage import MemoryStore
from app.youtube import fetch_captions
from app.main import AskInput, ask, state

class LocalEmbedding:
    async def embed(self,text): return feature_embedding(text)

class Caption(list):
    def __init__(self, language, text):
        super().__init__([SimpleNamespace(start=0,duration=15,text=text)])
        self.language=language
        self.is_generated=language=='hi'

class QualityTests(unittest.IsolatedAsyncioTestCase):
    def test_repeated_and_numeric_captions_are_not_evidence(self):
        for text in ('Harry Harry Harry Harry Harry','lower lower lower lower lower lower','0 0 0 0 0 0',''):
            self.assertFalse(informative(text))
        self.assertTrue(informative('पायथन में फॉर लूप का इस्तेमाल बार बार कोड चलाने के लिए होता है'))

    def test_import_chooses_hindi_over_corrupted_english(self):
        def track(language,text):
            return SimpleNamespace(language_code=language,is_generated=language=='hi',fetch=lambda:Caption(language,text))
        tracks=[track('en','Harry Harry Harry Harry Harry Harry'),track('hi','पायथन में लूप का उपयोग कोड को दोहराने के लिए किया जाता है')]
        with patch('app.youtube.YouTubeTranscriptApi') as api,patch('app.youtube.TimeoutSession') as session:
            api.return_value.list.return_value=tracks
            session.return_value.__enter__.return_value.get.side_effect=ValueError()
            result=fetch_captions('UrsmFxEIp5k')
        self.assertEqual(result['language'],'hi')
        self.assertEqual(caption_quality(result['rows']),1.0)

    async def test_so_far_spans_history_skips_garbage_and_excludes_future(self):
        store=MemoryStore()
        course=await store.add_course('Python',video_url='https://youtu.be/UrsmFxEIp5k')
        for i in range(100):
            text=f'Python programming concept number {i} explained with a useful example.' if i<90 else 'Harry Harry Harry Harry Harry'
            store.chunks[course['id']].append(Chunk(str(i),course['id'],'r','lesson','video',text,feature_embedding(text),i*20,i*20+19))
        rows=await Retriever(store,LocalEmbedding()).covered(course['id'],1950)
        self.assertEqual(len(rows),8)
        self.assertLess(rows[0]['end_time'],100)
        self.assertGreater(rows[-1]['end_time'],1700)
        self.assertTrue(all(row['end_time']<=1950 and informative(row['content']) for row in rows))

    async def test_empty_broad_actions_never_query_future(self):
        store=MemoryStore()
        course=await store.add_course('Python',video_url='https://youtu.be/UrsmFxEIp5k')
        retriever=Retriever(store,LocalEmbedding())
        with patch.object(state,'retriever',retriever),patch.object(retriever,'retrieve',side_effect=AssertionError('Broad actions must not search future content')):
            for action,position in [('summary',0),('quiz',100)]:
                result=await ask(AskInput(course_id=course['id'],question='What is this lesson about?',action=action,video_time_seconds=position),store)
                self.assertNotEqual(result['refusal_reason'],'future_video_content')
                self.assertEqual(result['citations'],[])

    def test_multilingual_ranking_uses_semantics_and_rejects_weak_similarity(self):
        embedder=SimpleNamespace(settings=SimpleNamespace(embedding_provider='gemini'))
        rows=[{'content':'पायथन में लूप का उपयोग कोड को दोहराने के लिए किया जाता है','score':0.01,'semantic_score':0.75}, {'content':'Harry describes an unrelated lesson introduction.','score':0.03,'semantic_score':0.4}]
        ranked=Retriever(None,embedder)._rerank('Explain loops in Python',rows)
        self.assertEqual(len(ranked),1)
        self.assertIn('पायथन',ranked[0]['content'])

    async def test_simplify_after_quiz_uses_watched_material_not_generic_button_text(self):
        store=MemoryStore()
        course=await store.add_course('Python',video_url='https://youtu.be/UrsmFxEIp5k')
        session=await store.create_session(course['id'])
        await store.append_message(session['id'],'user','Quiz me on concepts covered so far')
        retriever=Retriever(store,LocalEmbedding())
        with patch.object(state,'retriever',retriever),patch.object(retriever,'retrieve',side_effect=AssertionError('Do not search button text')):
            result=await ask(AskInput(course_id=course['id'],session_id=session['id'],question='Explain the idea in simpler words',action='simplify',video_time_seconds=14346),store)
        self.assertEqual(result['refusal_reason'],'unsupported_by_resources')
