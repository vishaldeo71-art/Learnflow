"""Repository adapters: in-memory demo and async PostgreSQL/Supabase production store."""

import json
import uuid
from collections import defaultdict
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
            """SELECT s.*, (1-(c.embedding OPERATOR(extensions.<=>) $2::text::extensions.vector))::real AS semantic_score
               FROM search_course_chunks($1::uuid,$2::text::extensions.vector,$3,$4,$5) s
               JOIN chunks c ON c.id=s.id""",
            course_id, _vector_literal(embedding), query, current_time, limit,
        )
        return [dict(row) for row in rows]

    async def covered_chunks(self, course_id: str, current_time: int, limit: int = 8) -> list[dict[str, Any]]:
        rows = await self.pool.fetch(
            """SELECT id,content,source_type,resource_name,start_time,end_time,page_number,slide_number,1.0::real AS score
               FROM chunks WHERE course_id=$1::uuid AND (source_type <> 'video' OR end_time <= $2)
               ORDER BY CASE WHEN source_type='video' THEN 0 ELSE 1 END, end_time DESC NULLS LAST
               LIMIT $3""", course_id, current_time, limit,
        )
        return [dict(row) for row in rows]

    async def study_chunks(self, course_id: str, current_time: int, limit: int = 120) -> list[dict[str, Any]]:
        # Rank only allowed rows. Sample across history and retain the recent section.
        rows = await self.pool.fetch(
            """WITH allowed AS (
                 SELECT id,content,source_type,resource_name,start_time,end_time,page_number,slide_number,
                        row_number() OVER (ORDER BY end_time NULLS FIRST,id) AS n,
                        count(*) OVER () AS total
                 FROM chunks WHERE course_id=$1::uuid AND (source_type <> 'video' OR end_time <= $2)
               ) SELECT *,1.0::real AS score FROM allowed
               WHERE n > total-24 OR mod(n-1,greatest(1,ceil(total::numeric / greatest(1,$3-24))::int))=0
               ORDER BY end_time NULLS FIRST LIMIT $3""", course_id, current_time, limit,
        )
        return [dict(row) for row in rows]

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
