"""Compatibility for the existing quiz/revision API, backed by private learner records."""
import json
import uuid
from fastapi import HTTPException
from .study_store import StudyRepository,utcnow

class LegacyStudyAdapter:
    def study_repository(self):
        return StudyRepository(self.base)

    async def get_location_chunks(self,course_id,source_id,source_type,location):
        if not await self.get_course(course_id):
            return []
        return await self.base.get_location_chunks(course_id,source_id,source_type,location)

    async def save_bookmark(self,bookmark):
        payload={"legacy":bookmark,"title":bookmark.get("note") or bookmark.get("resource_name","Bookmark"),"content":bookmark.get("saved_explanation") or bookmark.get("note",""),"video_time_seconds":bookmark.get("location",{}).get("seconds",0),"citations":[]}
        row=await self.study_repository().insert_item("bookmarks",self.user.id,bookmark["course_id"],payload)
        return {**bookmark,"id":str(row["id"])}

    async def list_bookmarks(self,course_id):
        rows=await self.study_repository().items("bookmarks",self.user.id,course_id)
        return [{**r["payload"].get("legacy",{"note":r["payload"]["title"],"saved_explanation":r["payload"].get("content",""),"concept_tags":[r["payload"]["title"]],"location":{"seconds":r["payload"].get("video_time_seconds",0)},"source_type":"video"}),"id":str(r["id"]),"course_id":course_id,"created_at":r["created_at"]} for r in rows]

    async def update_bookmark(self,bookmark_id,course_id,changes):
        repo=self.study_repository();row=await repo.get_item("bookmarks",bookmark_id,self.user.id)
        if not row or str(row["course_id"])!=course_id:return None
        legacy={**row["payload"].get("legacy",{}),**changes}
        payload={**row["payload"],"legacy":legacy,"content":legacy.get("saved_explanation") or legacy.get("note","")}
        await self._update_study_item("bookmarks",bookmark_id,payload)
        return {**legacy,"id":bookmark_id,"course_id":course_id}

    async def delete_bookmark(self,bookmark_id,course_id):
        repo=self.study_repository();row=await repo.get_item("bookmarks",bookmark_id,self.user.id)
        if not row or str(row["course_id"])!=course_id:return False
        await repo.remove("bookmarks",bookmark_id,self.user.id);return True

    @staticmethod
    def _legacy_question(q):
        citation=q.get("citation") or {}
        return {**q,"source_ids":[str(q.get("chunk_id") or citation.get("chunk_id") or "")],"citations":[citation] if citation else [],"topic_key":q.get("topic_key") or q["topic"],"difficulty":q.get("difficulty",1)}

    async def create_quiz(self,course_id,video_time_seconds,questions):
        converted=[{**self._legacy_question(q),"topic_key":course_id+":"+q["topic"].casefold()} for q in questions]
        row=await self.study_repository().insert_item("quizzes",self.user.id,course_id,{"kind":"legacy_mcq","questions":converted,"legacy_questions":questions,"answers":{},"video_time_seconds":video_time_seconds,"response_language":"en"})
        return {"id":str(row["id"]),"course_id":course_id,"video_time_seconds":video_time_seconds,"questions":questions}

    async def get_quiz(self,quiz_id,course_id):
        row=await self.study_repository().get_item("quizzes",quiz_id,self.user.id)
        if not row or str(row["course_id"])!=course_id or row["payload"].get("kind")!="legacy_mcq":return None
        return {"id":quiz_id,"course_id":course_id,"video_time_seconds":row["payload"]["video_time_seconds"],"questions":row["payload"]["legacy_questions"]}

    async def add_quiz_question(self,quiz_id,question):
        row=await self.study_repository().get_item("quizzes",quiz_id,self.user.id)
        if not row:raise HTTPException(404,"Quiz not found.")
        q={**self._legacy_question(question),"topic_key":str(row["course_id"])+":"+question["topic"].casefold()}
        if self.pool:
            await self.pool.execute("UPDATE practice_quizzes SET payload=jsonb_set(jsonb_set(payload,'{questions}',(payload->'questions')||$3::jsonb),'{legacy_questions}',(payload->'legacy_questions')||$4::jsonb) WHERE id=$1::uuid AND user_id=$2::uuid",quiz_id,self.user.id,json.dumps([q]),json.dumps([question]))
        else:
            row["payload"]["questions"].append(q);row["payload"]["legacy_questions"].append(question)

    async def record_quiz_attempt(self,attempt):
        result,_,_=await self.study_repository().grade(attempt["quiz_id"],self.user.id,attempt["question_id"],attempt["selected_index"])
        return {**attempt,"correct":result["correct"],"created_at":utcnow()}

    async def get_feature_data(self,course_id):
        repo=self.study_repository();quizzes=await repo.items("quizzes",self.user.id,course_id);topics=await repo.items("topics",self.user.id,course_id);notes=await repo.items("notes",self.user.id,course_id)
        attempts=[]
        for quiz in quizzes:
            for answer in quiz["payload"].get("answers",{}).values():
                attempts.append({**answer,"difficulty":1,"citation":(answer.get("citations") or [{}])[0],"created_at":quiz["created_at"]})
        return {"bookmarks":await self.list_bookmarks(course_id),"attempts":attempts,"reviews":[{"topic":t["title"],"last_reviewed":t["last_reviewed_at"]} for t in topics if t.get("last_reviewed_at")],"notes":[{**row["payload"].get("legacy",{"topic":row["payload"]["title"],"summary":row["payload"]["content"],"key_points":[],"source_refs":row["payload"].get("citations",[])}),"id":str(row["id"]),"course_id":course_id,"updated_at":row["created_at"]} for row in notes]}

    async def mark_revised(self,course_id,topic):
        repo=self.study_repository()
        for row in await repo.items("topics",self.user.id,course_id):
            if row["title"].casefold()==topic.casefold():await repo.review("topics",row["topic_key"],self.user.id)
        return {"course_id":course_id,"topic":topic,"last_reviewed":utcnow()}

    async def save_revision_note(self,note):
        payload={"legacy":note,"title":note["topic"],"content":note["summary"]+"\n"+"\n".join(note.get("key_points",[])),"citations":[],"video_time_seconds":0,"kind":"personal_note"}
        if note.get("id"):
            row=await self.study_repository().get_item("notes",note["id"],self.user.id)
            if not row or str(row["course_id"])!=note["course_id"]:raise HTTPException(404,"Study item not found.")
            await self._update_study_item("notes",note["id"],payload);return note
        row=await self.study_repository().insert_item("notes",self.user.id,note["course_id"],payload)
        return {**note,"id":str(row["id"])}

    async def delete_revision_note(self,note_id,course_id):
        repo=self.study_repository();row=await repo.get_item("notes",note_id,self.user.id)
        if not row or str(row["course_id"])!=course_id:return False
        await repo.remove("notes",note_id,self.user.id);return True

    async def _update_study_item(self,kind,item_id,payload):
        if self.pool:
            table={"notes":"study_notes","bookmarks":"study_bookmarks"}[kind]
            await self.pool.execute(f"UPDATE {table} SET payload=$3::jsonb WHERE id=$1::uuid AND user_id=$2::uuid",item_id,self.user.id,json.dumps(payload))
        else:
            row=await self.study_repository().get_item(kind,item_id,self.user.id);row["payload"]=payload
