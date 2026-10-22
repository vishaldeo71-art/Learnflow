"""Repository adapters: in-memory demo and async PostgreSQL/Supabase production store."""

import json
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from .domain import Chunk, Interview
from .embeddings import feature_embedding, tokens

DEMO_COURSE_ID = "00000000-0000-4000-8000-000000000001"


class MemoryStore:
    def __init__(self):
        self.courses: dict[str, dict[str, Any]] = {}
        self.chunks: dict[str, list[Chunk]] = defaultdict(list)
        self.sessions: dict[str, list[dict[str, str]]] = defaultdict(list)
        self.session_courses: dict[str, str] = {}
        self.interviews: dict[str, Interview] = {}
        self.resources: dict[str, dict[str, Any]] = {}
        self.bookmarks: dict[str, dict[str, Any]] = {}
        self.quizzes: dict[str, dict[str, Any]] = {}
        self.quiz_attempts: list[dict[str, Any]] = []
        self.topic_reviews: dict[tuple[str, str], dict[str, Any]] = {}
        self.revision_notes: dict[str, dict[str, Any]] = {}

    async def close(self):
        return None

    async def add_course(self, title: str, description: str = "", video_url: str | None = None, *, course_id: str | None = None) -> dict[str, Any]:
        course = {"id": course_id or str(uuid.uuid4()), "title": title, "description": description, "video_url": video_url}
        self.courses[course["id"]] = course
        return course

    async def clear_video_url(self, course_id: str):
        self.courses[course_id]["video_url"] = None

    async def get_course(self, course_id: str) -> dict[str, Any] | None:
        return self.courses.get(course_id)

    async def list_courses(self) -> list[dict[str, Any]]:
        return list(self.courses.values())

    async def add_resource(self, course_id: str, name: str, source_type: str, chunks: list[Chunk]) -> dict[str, Any]:
        existing = next((item for item in self.resources.values() if item["course_id"] == course_id and item["name"] == name), None)
        if existing:
            resource_id = existing["id"]
            self.chunks[course_id] = [chunk for chunk in self.chunks[course_id] if chunk.resource_id != resource_id]
        else:
            resource_id = str(uuid.uuid4())
        for chunk in chunks:
            chunk.resource_id = resource_id
            chunk.resource_name = name
            chunk.source_type = source_type
            self.chunks[course_id].append(chunk)
        resource = {"id": resource_id, "course_id": course_id, "name": name, "source_type": source_type, "chunk_count": len(chunks)}
        self.resources[resource_id] = resource
        return resource

    async def search_chunks(self, course_id: str, query: str, embedding: list[float], current_time: int, limit: int) -> list[dict[str, Any]]:
        query_tokens = set(tokens(query))
        candidates: list[tuple[float, Chunk]] = []
        for chunk in self.chunks.get(course_id, []):
            if chunk.source_type == "video" and (chunk.end_time is None or chunk.end_time > current_time):
                continue
            content_tokens = set(tokens(chunk.content))
            lexical = len(query_tokens & content_tokens) / max(1, len(query_tokens))
            vector = sum(a * b for a, b in zip(embedding, chunk.embedding))
            score = 0.65 * max(0.0, vector) + 0.35 * lexical
            if score > 0:
                candidates.append((score, chunk))
        candidates.sort(key=lambda pair: pair[0], reverse=True)
        return [{**chunk.public_dict(), "score": score} for score, chunk in candidates[:limit]]

    async def covered_chunks(self, course_id: str, current_time: int, limit: int = 8) -> list[dict[str, Any]]:
        eligible = [chunk for chunk in self.chunks.get(course_id, [])
                    if chunk.source_type != "video" or (chunk.end_time is not None and chunk.end_time <= current_time)]
        eligible.sort(key=lambda chunk: (0 if chunk.source_type == "video" else 1, -(chunk.end_time or 0)))
        return [{**chunk.public_dict(), "score": 1.0} for chunk in eligible[:limit]]

    async def study_chunks(self, course_id: str, current_time: int, limit: int = 120) -> list[dict[str, Any]]:
        rows = await self.covered_chunks(course_id, current_time, len(self.chunks.get(course_id, [])))
        rows.sort(key=lambda row: row.get("end_time") or 0)
        if len(rows) <= limit:
            return rows
        recent = rows[-24:]
        earlier = rows[:-24]
        return [earlier[int(index * len(earlier) / (limit - 24))] for index in range(limit - 24)] + recent

    async def get_location_chunks(self, course_id: str, source_id: str, source_type: str, location: int) -> list[dict[str, Any]]:
        matches = [chunk.public_dict() for chunk in self.chunks.get(course_id, [])
                   if chunk.resource_id == source_id and chunk.source_type == source_type and
                   ((source_type == "video" and chunk.start_time is not None and chunk.end_time is not None and chunk.start_time <= location <= chunk.end_time) or
                    (source_type == "pdf" and chunk.page_number == location) or
                    (source_type == "ppt" and chunk.slide_number == location))]
        return matches

    async def save_bookmark(self, bookmark: dict[str, Any]) -> dict[str, Any]:
        saved = {"id": bookmark.get("id") or str(uuid.uuid4()), **bookmark}
        self.bookmarks[saved["id"]] = saved
        return saved

    async def list_bookmarks(self, course_id: str) -> list[dict[str, Any]]:
        return sorted((row.copy() for row in self.bookmarks.values() if row["course_id"] == course_id), key=lambda row: row["created_at"], reverse=True)

    async def update_bookmark(self, bookmark_id: str, course_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        item = self.bookmarks.get(bookmark_id)
        if not item or item["course_id"] != course_id:
            return None
        item.update(changes)
        return item.copy()

    async def delete_bookmark(self, bookmark_id: str, course_id: str) -> bool:
        item = self.bookmarks.get(bookmark_id)
        if not item or item["course_id"] != course_id:
            return False
        del self.bookmarks[bookmark_id]
        return True

    async def create_quiz(self, course_id: str, video_time_seconds: int, questions: list[dict[str, Any]]) -> dict[str, Any]:
        quiz = {"id": str(uuid.uuid4()), "course_id": course_id, "video_time_seconds": video_time_seconds, "questions": questions}
        self.quizzes[quiz["id"]] = quiz
        return quiz

    async def get_quiz(self, quiz_id: str, course_id: str) -> dict[str, Any] | None:
        quiz = self.quizzes.get(quiz_id)
        return quiz if quiz and quiz["course_id"] == course_id else None

    async def add_quiz_question(self, quiz_id: str, question: dict[str, Any]) -> None:
        self.quizzes[quiz_id]["questions"].append(question)

    async def record_quiz_attempt(self, attempt: dict[str, Any]) -> dict[str, Any]:
        saved = {"id": str(uuid.uuid4()), "created_at": now_utc(), **attempt}
        self.quiz_attempts.append(saved)
        return saved

    async def get_feature_data(self, course_id: str) -> dict[str, Any]:
        return {
            "bookmarks": await self.list_bookmarks(course_id),
            "attempts": [row.copy() for row in self.quiz_attempts if row["course_id"] == course_id],
            "reviews": [row.copy() for (cid, _), row in self.topic_reviews.items() if cid == course_id],
            "notes": [row.copy() for row in self.revision_notes.values() if row["course_id"] == course_id],
        }

    async def mark_revised(self, course_id: str, topic: str) -> dict[str, Any]:
        row = {"course_id": course_id, "topic": topic, "last_reviewed": now_utc()}
        self.topic_reviews[(course_id, topic.casefold())] = row
        return row

    async def save_revision_note(self, note: dict[str, Any]) -> dict[str, Any]:
        saved = {"id": note.get("id") or str(uuid.uuid4()), "updated_at": now_utc(), **note}
        self.revision_notes[saved["id"]] = saved
        return saved

    async def delete_revision_note(self, note_id: str, course_id: str) -> bool:
        note = self.revision_notes.get(note_id)
        if not note or note["course_id"] != course_id:
            return False
        del self.revision_notes[note_id]
        return True

    async def future_match(self, course_id: str, query: str, embedding: list[float], current_time: int) -> dict[str, Any] | None:
        query_tokens = set(tokens(query))
        matches = []
        for chunk in self.chunks.get(course_id, []):
            if chunk.source_type != "video" or chunk.end_time is None or chunk.end_time <= current_time:
                continue
            overlap = len(query_tokens & set(tokens(chunk.content))) / max(1, len(query_tokens))
            vector = sum(a * b for a, b in zip(embedding, chunk.embedding))
            if overlap >= 0.25 or vector >= 0.28:
                matches.append((max(overlap, vector), chunk))
        if not matches:
            return None
        score, chunk = max(matches, key=lambda item: item[0])
        return {"score": score, "start_time": chunk.start_time, "resource_name": chunk.resource_name}

    async def create_session(self, course_id: str) -> dict[str, str]:
        session = {"id": str(uuid.uuid4()), "course_id": course_id}
        self.sessions[session["id"]] = []
        self.session_courses[session["id"]] = course_id
        return session

    async def session_belongs_to_course(self, session_id: str, course_id: str) -> bool:
        return self.session_courses.get(session_id) == course_id

    async def get_messages(self, session_id: str, limit: int = 12) -> list[dict[str, str]]:
        return self.sessions.get(session_id, [])[-limit:]

    async def append_message(self, session_id: str, role: str, content: str) -> None:
        self.sessions[session_id].append({"role": role, "content": content})

    async def save_interview(self, interview: Interview) -> None:
        self.interviews[interview.id] = interview

    async def get_interview(self, interview_id: str) -> Interview | None:
        return self.interviews.get(interview_id)


class PostgresStore:
    def __init__(self, pool):
        self.pool = pool

    @classmethod
    async def connect(cls, dsn: str):
        import asyncpg

        return cls(await asyncpg.create_pool(
            dsn=dsn, min_size=0, max_size=3, command_timeout=30,
            statement_cache_size=0,
        ))

    async def close(self):
        await self.pool.close()

    async def add_course(self, title: str, description: str = "", video_url: str | None = None, *, course_id: str | None = None) -> dict[str, Any]:
        row = await self.pool.fetchrow(
            """INSERT INTO courses(id,title,description,video_url) VALUES($1::uuid,$2,$3,$4)
               ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title
               RETURNING id::text,title,description,video_url""",
            course_id or str(uuid.uuid4()), title, description, video_url,
        )
        return dict(row)

    async def clear_video_url(self, course_id: str):
        await self.pool.execute("UPDATE courses SET video_url=NULL WHERE id=$1::uuid", course_id)

    async def get_course(self, course_id: str) -> dict[str, Any] | None:
        row = await self.pool.fetchrow("SELECT id::text,title,description,video_url FROM courses WHERE id=$1::uuid", course_id)
        return dict(row) if row else None

    async def list_courses(self) -> list[dict[str, Any]]:
        rows = await self.pool.fetch("SELECT id::text,title,description,video_url FROM courses ORDER BY created_at DESC")
        return [dict(row) for row in rows]

    async def add_resource(self, course_id: str, name: str, source_type: str, chunks: list[Chunk]) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                resource_id = await conn.fetchval(
                    """INSERT INTO resources(course_id,name,source_type) VALUES($1::uuid,$2,$3)
                       ON CONFLICT(course_id,name) DO UPDATE SET source_type=EXCLUDED.source_type
                       RETURNING id::text""", course_id, name, source_type,
                )
                await conn.execute("DELETE FROM chunks WHERE resource_id=$1::uuid", resource_id)
                if chunks:
                    await conn.executemany(
                        """INSERT INTO chunks(id,course_id,resource_id,source_type,resource_name,content,embedding,
                           start_time,end_time,page_number,slide_number)
                           VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::extensions.vector,$8,$9,$10,$11)""",
                        [(chunk.id, course_id, resource_id, source_type, name, chunk.content,
                          _vector_literal(chunk.embedding), chunk.start_time, chunk.end_time,
                          chunk.page_number, chunk.slide_number) for chunk in chunks],
                    )
        return {"id": resource_id, "course_id": course_id, "name": name, "source_type": source_type, "chunk_count": len(chunks)}

    async def search_chunks(self, course_id: str, query: str, embedding: list[float], current_time: int, limit: int) -> list[dict[str, Any]]:
        rows = await self.pool.fetch(
            """SELECT s.*, c.resource_id::text AS resource_id, (1-(c.embedding OPERATOR(extensions.<=>) $2::text::extensions.vector))::real AS semantic_score
               FROM search_course_chunks($1::uuid,$2::text::extensions.vector,$3,$4,$5) s
               JOIN chunks c ON c.id=s.id""",
            course_id, _vector_literal(embedding), query, current_time, limit,
        )
        return [dict(row) for row in rows]

    async def covered_chunks(self, course_id: str, current_time: int, limit: int = 8) -> list[dict[str, Any]]:
        rows = await self.pool.fetch(
            """SELECT id::text,resource_id::text,course_id::text,content,source_type,resource_name,start_time,end_time,page_number,slide_number,1.0::real AS score
               FROM chunks WHERE course_id=$1::uuid AND (source_type <> 'video' OR end_time <= $2)
               ORDER BY CASE WHEN source_type='video' THEN 0 ELSE 1 END, end_time DESC NULLS LAST
               LIMIT $3""", course_id, current_time, limit,
        )
        return [dict(row) for row in rows]

    async def study_chunks(self, course_id: str, current_time: int, limit: int = 120) -> list[dict[str, Any]]:
        # Rank only allowed rows. Sample across history and retain the recent section.
        rows = await self.pool.fetch(
            """WITH allowed AS (
                 SELECT id::text,resource_id::text,course_id::text,content,source_type,resource_name,start_time,end_time,page_number,slide_number,
                        row_number() OVER (ORDER BY end_time NULLS FIRST,id) AS n,
                        count(*) OVER () AS total
                 FROM chunks WHERE course_id=$1::uuid AND (source_type <> 'video' OR end_time <= $2)
               ) SELECT *,1.0::real AS score FROM allowed
               WHERE n > total-24 OR mod(n-1,greatest(1,ceil(total::numeric / greatest(1,$3-24))::int))=0
               ORDER BY end_time NULLS FIRST LIMIT $3""", course_id, current_time, limit,
        )
        return [dict(row) for row in rows]

    async def get_location_chunks(self, course_id: str, source_id: str, source_type: str, location: int) -> list[dict[str, Any]]:
        if source_type == "video":
            predicate, value = "start_time <= $4 AND end_time >= $4", location
        elif source_type == "pdf":
            predicate, value = "page_number = $4", location
        elif source_type == "ppt":
            predicate, value = "slide_number = $4", location
        else:
            return []
        rows = await self.pool.fetch(
            f"""SELECT id::text,resource_id::text,course_id::text,source_type,resource_name,content,start_time,end_time,page_number,slide_number
                FROM chunks WHERE course_id=$1::uuid AND resource_id=$2::uuid AND source_type=$3 AND {predicate}
                ORDER BY coalesce(start_time,0),id""", course_id, source_id, source_type, value,
        )
        return [dict(row) for row in rows]

    async def save_bookmark(self, bookmark: dict[str, Any]) -> dict[str, Any]:
        row = await self.pool.fetchrow(
            """INSERT INTO public.bookmarks(course_id,source_id,source_type,resource_name,location,note,saved_explanation,concept_tags)
               VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7,$8)
               RETURNING id::text,course_id::text,source_id::text,source_type,resource_name,location,note,saved_explanation,concept_tags,created_at""",
            bookmark["course_id"], bookmark.get("source_id"), bookmark["source_type"], bookmark["resource_name"],
            json.dumps(bookmark.get("location", {})), bookmark.get("note", ""), bookmark.get("saved_explanation", ""), bookmark.get("concept_tags", []),
        )
        return _json_row(dict(row))

    async def list_bookmarks(self, course_id: str) -> list[dict[str, Any]]:
        rows = await self.pool.fetch("""SELECT id::text,course_id::text,source_id::text,source_type,resource_name,location,note,saved_explanation,concept_tags,created_at
                                         FROM public.bookmarks WHERE course_id=$1::uuid ORDER BY created_at DESC""", course_id)
        return [_json_row(dict(row)) for row in rows]

    async def update_bookmark(self, bookmark_id: str, course_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        row = await self.pool.fetchrow(
            """UPDATE public.bookmarks SET note=coalesce($3,note),saved_explanation=coalesce($4,saved_explanation),
               concept_tags=coalesce($5,concept_tags) WHERE id=$1::uuid AND course_id=$2::uuid
               RETURNING id::text,course_id::text,source_id::text,source_type,resource_name,location,note,saved_explanation,concept_tags,created_at""",
            bookmark_id, course_id, changes.get("note"), changes.get("saved_explanation"), changes.get("concept_tags"),
        )
        return _json_row(dict(row)) if row else None

    async def delete_bookmark(self, bookmark_id: str, course_id: str) -> bool:
        result = await self.pool.execute("DELETE FROM public.bookmarks WHERE id=$1::uuid AND course_id=$2::uuid", bookmark_id, course_id)
        return result.endswith("1")

    async def create_quiz(self, course_id: str, video_time_seconds: int, questions: list[dict[str, Any]]) -> dict[str, Any]:
        row = await self.pool.fetchrow(
            """INSERT INTO public.quiz_sets(course_id,video_time_seconds,questions) VALUES($1::uuid,$2,$3::jsonb)
               RETURNING id::text,course_id::text,video_time_seconds,questions""", course_id, video_time_seconds, json.dumps(questions),
        )
        return _json_row(dict(row))

    async def get_quiz(self, quiz_id: str, course_id: str) -> dict[str, Any] | None:
        row = await self.pool.fetchrow("SELECT id::text,course_id::text,video_time_seconds,questions FROM public.quiz_sets WHERE id=$1::uuid AND course_id=$2::uuid", quiz_id, course_id)
        return _json_row(dict(row)) if row else None

    async def add_quiz_question(self, quiz_id: str, question: dict[str, Any]) -> None:
        await self.pool.execute("UPDATE public.quiz_sets SET questions=questions || $2::jsonb WHERE id=$1::uuid", quiz_id, json.dumps([question]))

    async def record_quiz_attempt(self, attempt: dict[str, Any]) -> dict[str, Any]:
        row = await self.pool.fetchrow(
            """INSERT INTO public.quiz_attempts(course_id,quiz_id,question_id,topic,correct,difficulty,selected_index,citation)
               VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::jsonb)
               RETURNING id::text,course_id::text,quiz_id::text,question_id,topic,correct,difficulty,selected_index,citation,created_at""",
            attempt["course_id"], attempt["quiz_id"], attempt["question_id"], attempt["topic"], attempt["correct"], attempt["difficulty"], attempt["selected_index"], json.dumps(attempt.get("citation", {})),
        )
        return dict(row)

    async def get_feature_data(self, course_id: str) -> dict[str, Any]:
        bookmarks = await self.list_bookmarks(course_id)
        attempts = [_json_row(dict(row)) for row in await self.pool.fetch("""SELECT id::text,course_id::text,quiz_id::text,question_id,topic,correct,difficulty,selected_index,citation,created_at
                                                                    FROM public.quiz_attempts WHERE course_id=$1::uuid ORDER BY created_at""", course_id)]
        reviews = [dict(row) for row in await self.pool.fetch("SELECT course_id::text,topic,last_reviewed FROM public.topic_reviews WHERE course_id=$1::uuid", course_id)]
        notes = [_json_row(dict(row)) for row in await self.pool.fetch("""SELECT id::text,course_id::text,topic,summary,key_points,source_refs,updated_at
                                                                         FROM public.revision_notes WHERE course_id=$1::uuid ORDER BY updated_at DESC""", course_id)]
        return {"bookmarks": bookmarks, "attempts": attempts, "reviews": reviews, "notes": notes}

    async def mark_revised(self, course_id: str, topic: str) -> dict[str, Any]:
        row = await self.pool.fetchrow("""INSERT INTO public.topic_reviews(course_id,topic,last_reviewed) VALUES($1::uuid,$2,now())
            ON CONFLICT(course_id,topic) DO UPDATE SET last_reviewed=now() RETURNING course_id::text,topic,last_reviewed""", course_id, topic)
        return dict(row)

    async def save_revision_note(self, note: dict[str, Any]) -> dict[str, Any]:
        row = await self.pool.fetchrow(
            """INSERT INTO public.revision_notes(id,course_id,topic,summary,key_points,source_refs)
               VALUES(coalesce($1::uuid,gen_random_uuid()),$2::uuid,$3,$4,$5::jsonb,$6::jsonb)
               ON CONFLICT(id) DO UPDATE SET topic=EXCLUDED.topic,summary=EXCLUDED.summary,key_points=EXCLUDED.key_points,source_refs=EXCLUDED.source_refs,updated_at=now()
               RETURNING id::text,course_id::text,topic,summary,key_points,source_refs,updated_at""",
            note.get("id"), note["course_id"], note["topic"], note["summary"], json.dumps(note.get("key_points", [])), json.dumps(note.get("source_refs", [])),
        )
        return _json_row(dict(row))

    async def delete_revision_note(self, note_id: str, course_id: str) -> bool:
        result = await self.pool.execute("DELETE FROM public.revision_notes WHERE id=$1::uuid AND course_id=$2::uuid", note_id, course_id)
        return result.endswith("1")

    async def future_match(self, course_id: str, query: str, embedding: list[float], current_time: int) -> dict[str, Any] | None:
        row = await self.pool.fetchrow(
            "SELECT * FROM find_future_video_match($1::uuid,$2::text::extensions.vector,$3,$4)",
            course_id, _vector_literal(embedding), query, current_time,
        )
        return dict(row) if row else None

    async def create_session(self, course_id: str) -> dict[str, str]:
        row = await self.pool.fetchrow("INSERT INTO learning_sessions(course_id) VALUES($1::uuid) RETURNING id::text,course_id::text", course_id)
        return dict(row)

    async def session_belongs_to_course(self, session_id: str, course_id: str) -> bool:
        return await self.pool.fetchval(
            "SELECT EXISTS(SELECT 1 FROM learning_sessions WHERE id=$1::uuid AND course_id=$2::uuid)", session_id, course_id
        )

    async def get_messages(self, session_id: str, limit: int = 12) -> list[dict[str, str]]:
        rows = await self.pool.fetch(
            "SELECT role,content FROM (SELECT role,content,created_at FROM chat_messages WHERE session_id=$1::uuid ORDER BY created_at DESC LIMIT $2) q ORDER BY created_at",
            session_id, limit,
        )
        return [dict(row) for row in rows]

    async def append_message(self, session_id: str, role: str, content: str) -> None:
        await self.pool.execute("INSERT INTO chat_messages(session_id,role,content) VALUES($1::uuid,$2,$3)", session_id, role, content)

    async def save_interview(self, interview: Interview) -> None:
        payload = json.dumps(interview.to_dict())
        await self.pool.execute(
            """INSERT INTO interview_sessions(id,payload,completed) VALUES($1::uuid,$2::jsonb,$3)
               ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload, completed=EXCLUDED.completed, updated_at=now()""",
            interview.id, payload, interview.completed,
        )

    async def get_interview(self, interview_id: str) -> Interview | None:
        row = await self.pool.fetchrow("SELECT payload FROM interview_sessions WHERE id=$1::uuid", interview_id)
        if not row:
            return None
        raw = row["payload"]
        data = json.loads(raw) if isinstance(raw, str) else dict(raw)
        return Interview(**data)


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_row(row: dict[str, Any]) -> dict[str, Any]:
    for key in ("location", "questions", "key_points", "source_refs", "citation"):
        value = row.get(key)
        if isinstance(value, str):
            try:
                row[key] = json.loads(value)
            except json.JSONDecodeError:
                pass
    return row
