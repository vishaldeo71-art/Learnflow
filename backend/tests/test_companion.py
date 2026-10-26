import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi import HTTPException
from app.auth import Identity, current_user
from app.companion import CompanionInput, companion_router, validate_presentation
from app.main import AskInput
from app.scoped_store import ScopedStore
from app.storage import MemoryStore
from app.study_store import StudyRepository


class CompanionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.user = Identity('11111111-1111-4111-8111-111111111111','test@example.test')
        self.token = current_user.set(self.user)
        self.base = MemoryStore(); self.store = ScopedStore(self.base,self.user)
        self.course = await self.store.add_course('Lumi test')
        self.citation = {'chunk_id':'s1','source_type':'text','resource_name':'Lesson','excerpt':'Distance equals speed multiplied by time. Speed is distance per unit time.'}
        self.answer = {'answer':'Distance equals speed multiplied by time.','citations':[self.citation],'session_id':'session','refusal_reason':None}
        self.guide = AsyncMock(return_value=self.answer)
        self.raw = {'gesture':'explain','kind':'concept_map','title':'Distance','nodes':[
            {'label':'Distance','detail':'Speed multiplied by time','source_id':'s1','quote':self.citation['excerpt']},
            {'label':'Speed','detail':'Distance per unit time','source_id':'s1','quote':self.citation['excerpt']}]}
        self.llm = AsyncMock(return_value=json.dumps(self.raw))
        router = companion_router(lambda: None,SimpleNamespace(llm=SimpleNamespace(generate=self.llm)),self.guide,AskInput)
        self.endpoint = next(r.endpoint for r in router.routes if r.path.endswith('/ask'))

    async def asyncTearDown(self):
        current_user.reset(self.token)

    def payload(self,**values):
        return CompanionInput(course_id=self.course['id'],question='Explain distance',video_time_seconds=42,response_language='fr',**values)

    async def test_reuses_verified_guide_and_exact_playhead_language(self):
        result = await self.endpoint(self.payload(),self.store)
        self.assertEqual(result['visual']['kind'],'concept_map')
        args = self.guide.call_args.args[0]
        self.assertEqual(args.video_time_seconds,42); self.assertEqual(args.response_language,'fr')
        self.assertEqual(result['citations'],self.answer['citations'])

    async def test_visual_failure_preserves_grounded_answer(self):
        self.llm.side_effect = RuntimeError('Provider unavailable')
        result = await self.endpoint(self.payload(),self.store)
        self.assertEqual(result['answer'],self.answer['answer']); self.assertIsNone(result['visual'])

    async def test_refusal_never_generates_unsupported_visual(self):
        self.guide.return_value = {**self.answer,'refusal_reason':'future_video_content','citations':[]}
        result = await self.endpoint(self.payload(),self.store)
        self.assertEqual(result['gesture'],'encourage'); self.llm.assert_not_called()

    async def test_unknown_quote_or_source_is_rejected(self):
        self.raw['nodes'][0]['quote'] = 'This unsupported sentence does not exist in the lesson.'
        with self.assertRaises(ValueError): validate_presentation(self.raw,[self.citation])
        self.raw['nodes'][0].update(source_id='future-secret',quote=self.citation['excerpt'])
        with self.assertRaises(ValueError): validate_presentation(self.raw,[self.citation])

    async def test_arbitrary_html_or_script_cannot_be_a_scene_type(self):
        self.raw['kind'] = '<script>alert(1)</script>'
        with self.assertRaises(ValueError): validate_presentation(self.raw,[self.citation])

    async def test_cannot_read_another_learners_course(self):
        other = ScopedStore(self.base,Identity('22222222-2222-4222-8222-222222222222','other@example.test'))
        with self.assertRaises(HTTPException) as ctx: await self.endpoint(self.payload(),other)
        self.assertEqual(ctx.exception.status_code,404); self.guide.assert_not_called()

    async def test_no_mistakes_does_not_invent_a_weak_topic(self):
        result = await self.endpoint(self.payload(mode='mistakes'),self.store)
        self.assertEqual(result['status'],'no_weak_topics'); self.guide.assert_not_called()

    async def test_mistakes_use_only_actual_private_watched_progress(self):
        repo = StudyRepository(self.base)
        # Memory store represents the same private repository used by the production role.
        self.store.study_chunks = AsyncMock(return_value=[{'id':'s1','source_type':'video','end_time':40}])
        repo.items = AsyncMock()
        from unittest.mock import patch
        with patch('app.companion.StudyRepository') as repository:
            repository.return_value.items = AsyncMock(side_effect=[[{'topic_key':'variables','title':'Private variable topic','incorrect':2,'attempts':2,'correct_streak':0,'source_ids':['s1']}, {'title':'Future topic','incorrect':10,'attempts':10,'correct_streak':0,'source_ids':['future']}], []])
            await self.endpoint(self.payload(mode='mistakes'),self.store)
        text = self.guide.call_args.args[0].question
        self.assertIn('Private variable topic',text); self.assertNotIn('Future topic',text)

    async def test_requires_authenticated_identity(self):
        token = current_user.set(None)
        try:
            with self.assertRaises(HTTPException) as ctx: await self.endpoint(self.payload(),self.store)
            self.assertEqual(ctx.exception.status_code,401)
        finally: current_user.reset(token)
