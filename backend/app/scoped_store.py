"""Request-scoped authorization around the existing repository.

Only the service DB role can use these methods. The HTTP identity is independently
verified against Supabase Auth, and every identifier lookup applies ownership.
"""
import json
import uuid
from fastapi import HTTPException


from .legacy_study import LegacyStudyAdapter


class ScopedStore(LegacyStudyAdapter):
    def __init__(self, base, user):
        self.base, self.user = base, user
        self.pool = getattr(base, "pool", None)

    def __getattr__(self, name):
        return getattr(self.base, name)

    async def get_course(self, course_id):
        if self.pool:
            row = await self.pool.fetchrow("SELECT id::text,title,description,video_url,created_by::text FROM courses WHERE id=$1::uuid AND (created_by=$2::uuid OR created_by IS NULL)", course_id, self.user.id)
            return dict(row) if row else None
        row = await self.base.get_course(course_id)
        return row if row and row.get("created_by") in (None, self.user.id) else None

    async def writable_course(self, course_id):
        row = await self.get_course(course_id)
        if not row:
            raise HTTPException(404, "Course not found")
        if row.get("created_by") != self.user.id:
            raise HTTPException(403, "Create a private course before uploading your materials.")
        return row

    async def list_courses(self):
        if self.pool:
            rows = await self.pool.fetch("SELECT id::text,title,description,video_url,created_by::text FROM courses WHERE created_by=$1::uuid OR created_by IS NULL ORDER BY created_at DESC", self.user.id)
            return [dict(row) for row in rows]
        return [row for row in await self.base.list_courses() if row.get("created_by") in (None, self.user.id)]

    async def add_course(self, title, description="", video_url=None, **kwargs):
        if self.pool:
            row = await self.pool.fetchrow("INSERT INTO courses(title,description,video_url,created_by) VALUES($1,$2,$3,$4::uuid) RETURNING id::text,title,description,video_url,created_by::text", title, description, video_url, self.user.id)
            return dict(row)
        row = await self.base.add_course(title, description, video_url, **kwargs)
        row["created_by"] = self.user.id
        return row

    async def create_session(self, course_id):
        if not await self.get_course(course_id):
            raise HTTPException(404, "Course not found")
        if self.pool:
            row = await self.pool.fetchrow("INSERT INTO learning_sessions(course_id,user_id) VALUES($1::uuid,$2::uuid) RETURNING id::text,course_id::text", course_id, self.user.id)
            return dict(row)
        row = await self.base.create_session(course_id)
        self.base.session_owners[row["id"]] = self.user.id
        return row

    async def owns_session(self, session_id):
        if self.pool:
            return await self.pool.fetchval("SELECT EXISTS(SELECT 1 FROM learning_sessions WHERE id=$1::uuid AND user_id=$2::uuid)", session_id, self.user.id)
        return self.base.session_owners.get(session_id) == self.user.id

    async def session_belongs_to_course(self, session_id, course_id):
        return await self.owns_session(session_id) and await self.base.session_belongs_to_course(session_id, course_id)

    async def get_messages(self, session_id, limit=12):
        if not await self.owns_session(session_id):
            raise HTTPException(404, "Learning session not found for this course")
        if self.pool:
            rows = await self.pool.fetch("SELECT id::text,role,content,metadata FROM (SELECT * FROM chat_messages WHERE session_id=$1::uuid ORDER BY created_at DESC LIMIT $2) q ORDER BY created_at", session_id, limit)
            return [{**dict(row), "metadata": json.loads(row["metadata"]) if isinstance(row["metadata"], str) else row["metadata"]} for row in rows]
        return await self.base.get_messages(session_id, limit)

    async def append_message(self, session_id, role, content, metadata=None):
        if not await self.owns_session(session_id):
            raise HTTPException(404, "Learning session not found for this course")
        message_id = str(uuid.uuid4())
        if self.pool:
            await self.pool.execute("INSERT INTO chat_messages(id,session_id,role,content,metadata) VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb)", message_id, session_id, role, content, json.dumps(metadata or {}))
        else:
            self.base.sessions[session_id].append({"id": message_id, "role": role, "content": content, "metadata": metadata or {}})
        return message_id

    async def save_interview(self, interview):
        if self.pool:
            result = await self.pool.execute("INSERT INTO interview_sessions(id,user_id,payload,completed) VALUES($1::uuid,$2::uuid,$3::jsonb,$4) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,completed=EXCLUDED.completed,updated_at=now() WHERE interview_sessions.user_id=EXCLUDED.user_id", interview.id, self.user.id, json.dumps(interview.to_dict()), interview.completed)
            if result.endswith(" 0"):
                raise HTTPException(404, "Interview not found")
        else:
            owner = self.base.interview_owners.setdefault(interview.id, self.user.id)
            if owner != self.user.id:
                raise HTTPException(404, "Interview not found")
            await self.base.save_interview(interview)

    async def get_interview(self, interview_id):
        if self.pool:
            owned = await self.pool.fetchval("SELECT EXISTS(SELECT 1 FROM interview_sessions WHERE id=$1::uuid AND user_id=$2::uuid)", interview_id, self.user.id)
        else:
            owned = self.base.interview_owners.get(interview_id) == self.user.id
        return await self.base.get_interview(interview_id) if owned else None
