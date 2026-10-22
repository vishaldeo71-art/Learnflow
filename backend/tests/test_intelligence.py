import unittest
from fastapi import HTTPException
from app.intelligence import (make_recall_question,evaluate_recall,validate_artifact,evidence_references,Reference,TOOL_SECTIONS)
from app.study import public_quiz
from app.study_store import grade_payload

class IntelligenceTests(unittest.TestCase):
    def setUp(self):
        self.source={'id':'s1','content':'d = v × t. Distance equals speed multiplied by time. The symbol d denotes distance. The nucleus contains DNA, also called deoxyribonucleic acid. Article 32 protects the remedy in this handout.','source_type':'pdf','resource_name':'lesson.pdf','page_number':2}
        self.rows=[self.source]
    def raw(self):
        return {'question':'Which structure contains DNA?','reference_answer':'nucleus','accepted_answers':['the nucleus','unrelated guess'],'precision':'concept','topic':'Cell structure','canonical_topic':'cell structure','explanation':'The source states that the nucleus contains DNA.','references':[{'source_id':'s1','quote':'The nucleus contains DNA, also called deoxyribonucleic acid.'}]}
    def test_reference_answer_must_occur_in_verified_quote(self):
        raw=self.raw();raw['reference_answer']='mitochondrion'
        with self.assertRaises(ValueError):make_recall_question(raw,self.rows,'c')
    def test_unknown_or_future_source_cannot_be_cited(self):
        with self.assertRaises(ValueError):evidence_references([Reference(source_id='future',quote='An unseen future passage')],self.rows)
    def test_invented_quote_cannot_be_cited(self):
        with self.assertRaises(ValueError):evidence_references([Reference(source_id='s1',quote='The mitochondrion contains every cell structure')],self.rows)
    def test_superficial_case_and_typo_are_accepted(self):
        q=make_recall_question(self.raw(),self.rows,'c')
        for value in ['Nucleus','nucleuss','nuclues','the nucleus']:self.assertTrue(evaluate_recall(value,q),value)
        self.assertFalse(evaluate_recall('mitochondrion',q))
    def test_spelling_challenge_rejects_misspelling(self):
        raw=self.raw();raw['precision']='spelling';q=make_recall_question(raw,self.rows,'c')
        self.assertTrue(evaluate_recall('NUCLEUS',q));self.assertFalse(evaluate_recall('nucleuss',q))
    def test_supported_synonyms_and_abbreviations_are_allowed(self):
        raw=self.raw();raw.update(reference_answer='DNA',accepted_answers=['deoxyribonucleic acid'])
        q=make_recall_question(raw,self.rows,'c');self.assertTrue(evaluate_recall('deoxyribonucleic acid',q))
    def test_unsupported_aliases_are_discarded(self):
        q=make_recall_question(self.raw(),self.rows,'c');self.assertNotIn('unrelated guess',q['accepted_answers'])
    def test_identifiers_do_not_get_fuzzy_matching(self):
        raw=self.raw();raw.update(reference_answer='32',accepted_answers=['Article 32'],precision='identifier',references=[{'source_id':'s1','quote':'Article 32 protects the remedy in this handout.'}])
        q=make_recall_question(raw,self.rows,'c');self.assertTrue(evaluate_recall('Article 32',q));self.assertFalse(evaluate_recall('226',q));self.assertFalse(evaluate_recall('33',q))
    def test_partial_number_is_not_a_verified_answer(self):
        raw=self.raw();raw.update(reference_answer='3',precision='identifier',references=[{'source_id':'s1','quote':'Article 32 protects the remedy in this handout.'}])
        with self.assertRaises(ValueError):make_recall_question(raw,self.rows,'c')
    def test_recall_answer_is_hidden_and_grading_is_retry_safe(self):
        q=make_recall_question(self.raw(),self.rows,'c');payload={'kind':'recall','questions':[q],'answers':{},'video_time_seconds':40,'response_language':'en'}
        public=public_quiz({'id':'q','course_id':'c','payload':payload})
        self.assertNotIn('reference_answer',public['questions'][0]);self.assertNotIn('accepted_answers',public['questions'][0])
        feedback,changed=grade_payload(payload,q['id'],'nucleuss');self.assertTrue(feedback['correct']);self.assertTrue(changed)
        _,changed=grade_payload(payload,q['id'],'nucleuss');self.assertFalse(changed)
        with self.assertRaises(HTTPException):grade_payload(payload,q['id'],'different')
    def test_formula_requires_every_section_and_real_evidence(self):
        data={'supported':True,'title':'Distance formula','sections':[{'key':key,'content':['Source-grounded explanation']} for key in TOOL_SECTIONS['formula']],'references':[{'source_id':'s1','quote':'Distance equals speed multiplied by time.'}]}
        data['sections'][0]['content']=['d = v × t'];artifact=validate_artifact('formula',data,self.rows);self.assertEqual(len(artifact['sections']),7);self.assertEqual(artifact['citations'][0]['page_number'],2)
        data['sections'].pop()
        with self.assertRaises(ValueError):validate_artifact('formula',data,self.rows)
    def test_unsupported_tool_refuses_instead_of_fabricating(self):
        with self.assertRaises(HTTPException) as ctx:validate_artifact('memory',{'supported':False,'title':'Unsupported'},self.rows)
        self.assertEqual(ctx.exception.status_code,422)
    def test_confusion_twins_requires_three_distinctions(self):
        data={'supported':True,'title':'Comparison','left_title':'A','right_title':'B','sections':[{'key':k,'content':['A sourced distinction']} for k in TOOL_SECTIONS['twins']],'references':[{'source_id':'s1','quote':'Distance equals speed multiplied by time.'}],'comparison':[{'aspect':'one','left':'a','right':'b'}]}
        with self.assertRaises(ValueError):validate_artifact('twins',data,self.rows)
    def test_checkpoint_requires_three_facts_two_confusions_one_question(self):
        data={'supported':True,'title':'Checkpoint','sections':[{'key':'facts','content':['one','two','three']},{'key':'confusions','content':['one','two']},{'key':'practice','content':['one']}],'references':[{'source_id':'s1','quote':'Distance equals speed multiplied by time.'}]}
        self.assertEqual(len(validate_artifact('checkpoint',data,self.rows)['sections']),3)
        data['sections'][0]['content'].pop()
        with self.assertRaises(ValueError):validate_artifact('checkpoint',data,self.rows)
    def test_signed_numbers_are_not_treated_as_the_same_fact(self):
        raw=self.raw();self.source['content']='The recorded value in this exercise is -2.'
        raw.update(reference_answer='-2',precision='identifier',accepted_answers=[],references=[{'source_id':'s1','quote':self.source['content']}])
        question=make_recall_question(raw,self.rows,'c')
        self.assertTrue(evaluate_recall('-2',question));self.assertFalse(evaluate_recall('2',question))
