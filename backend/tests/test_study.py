import asyncio
import json
import unittest
from datetime import timedelta
from fastapi import HTTPException
from app.auth import Identity, current_user, require_admin
from app.storage import MemoryStore
from app.scoped_store import ScopedStore
from app.study import public_quiz, validated_questions
from app.study_store import StudyRepository, priority, utcnow

class StudyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.base=MemoryStore();self.repo=StudyRepository(self.base)
        self.a=Identity('11111111-1111-4111-8111-111111111111','a@example.test')
        self.b=Identity('22222222-2222-4222-8222-222222222222','b@example.test')
        await self.repo.ensure_profile(self.a.id,self.a.email,'A');await self.repo.ensure_profile(self.b.id,self.b.email,'B')
        self.sa,self.sb=ScopedStore(self.base,self.a),ScopedStore(self.base,self.b)
        self.course=await self.sa.add_course('Private lesson')

    async def test_courses_sessions_and_messages_are_private(self):
        self.assertIsNone(await self.sb.get_course(self.course['id']));self.assertEqual(await self.sb.list_courses(),[])
        session=await self.sa.create_session(self.course['id']);await self.sa.append_message(session['id'],'assistant','Private content')
        with self.assertRaises(HTTPException) as ctx:await self.sb.get_messages(session['id'])
        self.assertEqual(ctx.exception.status_code,404)
        self.assertFalse(await self.sb.session_belongs_to_course(session['id'],self.course['id']))

    async def test_shared_examples_cannot_be_overwritten(self):
        shared=await self.base.add_course('Shared sample');self.assertIsNotNone(await self.sb.get_course(shared['id']))
        with self.assertRaises(HTTPException) as ctx:await self.sb.writable_course(shared['id'])
        self.assertEqual(ctx.exception.status_code,403)

    async def test_notes_are_private_and_idempotent(self):
        first=await self.repo.insert_item('notes',self.a.id,self.course['id'],{'content':'explanation'},origin='message:m1')
        second=await self.repo.insert_item('notes',self.a.id,self.course['id'],{'content':'changed'},origin='message:m1')
        self.assertEqual(first['id'],second['id']);self.assertEqual(first['payload']['content'],'explanation')
        self.assertIsNone(await self.repo.get_item('notes',first['id'],self.b.id));self.assertEqual(await self.repo.items('notes',self.b.id),[])

    def questions(self):
        source={'id':'source-1','content':'A variable stores a value that may change.','source_type':'video','start_time':0,'end_time':30,'resource_name':'Captions'}
        raw={'questions':[{'question':'What does a variable store?','options':['A value','A screen','A keyboard','A chapter'],'correct_index':0,'topic':'Variables','canonical_topic':'variables','explanation':'A variable stores a value that may change.','source_ids':['source-1']}]}
        return raw,[source]

    async def quiz(self):
        raw,sources=self.questions();questions=validated_questions(raw,sources,self.course['id'],2)
        return await self.repo.insert_item('quizzes',self.a.id,self.course['id'],{'questions':questions,'answers':{},'video_time_seconds':30,'response_language':'en'})

    async def test_answer_key_hidden_until_submission(self):
        row=await self.quiz();serialized=json.dumps(public_quiz(row))
        for secret in ['correct_index','explanation','source_ids']:self.assertNotIn(secret,serialized)
        q=row['payload']['questions'][0];result,_,changed=await self.repo.grade(row['id'],self.a.id,q['id'],1)
        self.assertTrue(changed);self.assertFalse(result['correct']);self.assertEqual(result['correct_index'],0);self.assertTrue(result['citations'])

    async def test_parallel_retries_do_not_double_count(self):
        row=await self.quiz();qid=row['payload']['questions'][0]['id']
        await asyncio.gather(*(self.repo.grade(row['id'],self.a.id,qid,1) for _ in range(5)))
        topic=(await self.repo.items('topics',self.a.id))[0]
        self.assertEqual(topic['attempts'],1);self.assertEqual(topic['incorrect'],1);self.assertEqual(topic['difficulty'],1)
        with self.assertRaises(HTTPException) as ctx:await self.repo.grade(row['id'],self.a.id,qid,0)
        self.assertEqual(ctx.exception.status_code,409)

    async def test_other_user_cannot_grade_quiz(self):
        row=await self.quiz()
        with self.assertRaises(HTTPException) as ctx:await self.repo.grade(row['id'],self.b.id,row['payload']['questions'][0]['id'],0)
        self.assertEqual(ctx.exception.status_code,404)

    def test_unknown_future_evidence_is_rejected(self):
        raw,sources=self.questions();raw['questions'][0]['source_ids']=['future-secret']
        self.assertEqual(validated_questions(raw,sources,self.course['id'],1),[])

    def test_ambiguous_duplicate_choices_are_rejected(self):
        raw,sources=self.questions();raw['questions'][0]['options']=['A value']*4
        self.assertEqual(validated_questions(raw,sources,self.course['id'],1),[])

    def test_revision_priority_uses_mistakes_and_recency(self):
        now=utcnow();recent={'incorrect':1,'last_reviewed_at':now}
        self.assertGreater(priority({'incorrect':1,'last_reviewed_at':now-timedelta(days=5)},now),priority(recent,now))
        self.assertGreater(priority({'incorrect':4,'last_reviewed_at':now},now),priority(recent,now))

    async def test_manual_review_does_not_invent_quiz_success(self):
        row=await self.quiz();q=row['payload']['questions'][0];await self.repo.grade(row['id'],self.a.id,q['id'],1)
        with self.assertRaises(HTTPException):await self.repo.review('topics',q['topic_key'],self.b.id)
        await self.repo.review('topics',q['topic_key'],self.a.id);topic=(await self.repo.items('topics',self.a.id))[0]
        self.assertEqual(topic['incorrect'],1);self.assertEqual(topic['correct_streak'],0)

    def test_regular_learner_cannot_access_admin(self):
        token=current_user.set(self.a)
        try:
            with self.assertRaises(HTTPException) as ctx:require_admin()
            self.assertEqual(ctx.exception.status_code,403)
        finally:current_user.reset(token)

class EvidenceAnswerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app.main import state
        from unittest.mock import AsyncMock
        from types import SimpleNamespace
        self.base=MemoryStore();self.repo=StudyRepository(self.base)
        self.user=Identity('11111111-1111-4111-8111-111111111111','a@example.test')
        await self.repo.ensure_profile(self.user.id,self.user.email,'A')
        self.store=ScopedStore(self.base,self.user);self.course=await self.store.add_course('Variables')
        self.source={'id':'source1','content':'Variables store values.','source_type':'pdf','page_number':3,'resource_name':'notes.pdf'}
        self.old_retriever,self.old_llm=state.retriever,state.llm
        state.retriever=SimpleNamespace(retrieve=AsyncMock(return_value=([self.source],None)),covered=AsyncMock(return_value=[self.source]))
        state.llm=SimpleNamespace(generate=AsyncMock())
        self.state=state

    async def asyncTearDown(self):
        self.state.retriever,self.state.llm=self.old_retriever,self.old_llm

    async def test_supported_answer_persists_evidence_and_auto_note(self):
        from app.main import ask,AskInput
        self.state.llm.generate.return_value=json.dumps({'answer':'Variables store values. [S1]','supported':True,'sources':['S1'],'concept':'Variables','revision_note':'A variable stores a value.'})
        result=await ask(AskInput(course_id=self.course['id'],question='How do variables work?',video_time_seconds=0),self.store)
        self.assertEqual(result['citations'][0]['page_number'],3);self.assertTrue(result['message_id'])
        notes=await self.repo.items('notes',self.user.id);self.assertEqual(len(notes),1)
        self.assertEqual(notes[0]['payload']['citations'][0]['chunk_id'],'source1')

    async def test_related_sources_do_not_force_an_unsupported_answer(self):
        from app.main import ask,AskInput
        self.state.llm.generate.return_value=json.dumps({'answer':'Not in the source','supported':False,'sources':[]})
        result=await ask(AskInput(course_id=self.course['id'],question='Explain black holes',video_time_seconds=0),self.store)
        self.assertEqual(result['refusal_reason'],'unsupported_by_resources');self.assertEqual(result['citations'],[])
        self.assertEqual(await self.repo.items('notes',self.user.id),[])

    async def test_broader_explanation_requires_prior_refusal_and_consent(self):
        from app.main import ask,AskInput
        payload=AskInput(course_id=self.course['id'],question='Explain black holes',video_time_seconds=0,allow_broader=True)
        with self.assertRaises(HTTPException):await ask(payload,self.store)
        self.state.llm.generate.return_value=json.dumps({'answer':'Not in source','supported':False,'sources':[]})
        result=await ask(payload.model_copy(update={'allow_broader':False}),self.store)
        self.state.llm.generate.return_value='This is general knowledge, not verified against your course.'
        broad=await ask(payload.model_copy(update={'session_id':result['session_id']}),self.store)
        self.assertEqual(broad['answer_mode'],'broader');self.assertEqual(broad['citations'],[])
        self.assertEqual(await self.repo.items('notes',self.user.id),[])

class LegacyPrivacyTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = StudyTests.asyncSetUp
    async def test_legacy_bookmarks_remain_private(self):
        bookmark=await self.sa.save_bookmark({'course_id':self.course['id'],'source_id':'r','source_type':'pdf','resource_name':'notes.pdf','location':{'page':2},'note':'Private bookmark'})
        self.assertEqual(await self.sb.list_bookmarks(self.course['id']),[])
        self.assertIsNone(await self.sb.update_bookmark(bookmark['id'],self.course['id'],{'note':'Overwrite'}))
        self.assertFalse(await self.sb.delete_bookmark(bookmark['id'],self.course['id']))
