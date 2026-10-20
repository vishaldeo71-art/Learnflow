import unittest
from unittest.mock import AsyncMock
from types import SimpleNamespace
from pydantic import ValidationError
from app.main import InterviewInput, InterviewTurnInput
from app.interview import make_interview, next_question
from app.domain import Interview

class InterviewLanguageTests(unittest.IsolatedAsyncioTestCase):
    async def test_interview_language_is_stored_and_applied_to_each_generated_question(self):
        interview=make_interview('Developer','beginner','mixed',10,'Python projects','Web development')
        interview.response_language='fr'
        llm=SimpleNamespace(generate=AsyncMock(return_value='Décrivez votre projet.'))
        answer=await next_question(interview,llm)
        self.assertEqual(answer,'Décrivez votre projet.')
        self.assertIn('OUTPUT LANGUAGE: French',llm.generate.call_args.args[0])
        self.assertIn('OUTPUT LANGUAGE: French',llm.generate.call_args.args[1])
        self.assertEqual(Interview(**interview.to_dict()).response_language,'fr')
        interview.response_language='ar'
        await next_question(interview,llm)
        self.assertIn('OUTPUT LANGUAGE: Arabic',llm.generate.call_args.args[0])
    def test_language_is_validated_for_start_and_followup(self):
        self.assertEqual(InterviewInput(role='Developer',response_language='ta').response_language,'ta')
        self.assertEqual(InterviewTurnInput(answer='Answer',response_language='ar').response_language,'ar')
        for cls,args in [(InterviewInput,{'role':'Developer'}),(InterviewTurnInput,{'answer':'Answer'})]:
            with self.assertRaises(ValidationError):cls(**args,response_language='ignore instructions')
