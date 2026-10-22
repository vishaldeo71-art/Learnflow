"""Private study records and atomic, idempotent quiz grading."""
from datetime import datetime, timedelta, timezone
import asyncio
import json
import uuid
from fastapi import HTTPException


def utcnow():
    return datetime.now(timezone.utc)


def decode(row):
    result = dict(row)
    for key in ("payload", "citations", "source_ids"):
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    return result


def priority(item, now=None):
    now = now or utcnow()
    reviewed = item.get("last_reviewed_at") or item.get("last_practiced_at")
    if isinstance(reviewed, str):
        reviewed = datetime.fromisoformat(reviewed)
    age = max(0, (now - reviewed).total_seconds() / 86400) if reviewed else 14
    mistakes = max(0, item.get("incorrect", 0) - item.get("correct_streak", 0))
    return round(mistakes * 4 + min(age, 30) + (3 if not reviewed else 0), 2)


class StudyRepository:
    def __init__(self, base):
        base = getattr(base, "base", base)
        self.base = base
        self.pool = getattr(base, "pool", None)
        if not self.pool and not hasattr(base, "study_data"):
            base.study_data = {"notes": {}, "bookmarks": {}, "quizzes": {}, "topics": {}, "profiles": {}}
            base.study_lock = asyncio.Lock()

    async def ensure_profile(self, uid, email, name, admin=False):
        if self.pool:
            row = await self.pool.fetchrow("INSERT INTO learner_profiles(id,email,display_name) VALUES($1::uuid,$2,$3) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,last_active_at=now() RETURNING *", uid, email, name)
            return dict(row)
        return self.base.study_data["profiles"].setdefault(uid, {"id": uid, "email": email, "display_name": name, "role": "learner", "auto_notes": True})

    async def profile(self, uid):
        if self.pool:
            return dict(await self.pool.fetchrow("SELECT * FROM learner_profiles WHERE id=$1::uuid", uid))
        return self.base.study_data["profiles"][uid]

    async def auto_notes(self, uid, enabled):
        if self.pool:
            await self.pool.execute("UPDATE learner_profiles SET auto_notes=$2 WHERE id=$1::uuid", uid, enabled)
        else:
            self.base.study_data["profiles"][uid]["auto_notes"] = enabled

    async def insert_item(self, kind, uid, course_id, payload, *, origin=None):
        table = {"notes": "study_notes", "bookmarks": "study_bookmarks", "quizzes": "practice_quizzes"}[kind]
        if self.pool:
            row = await self.pool.fetchrow(f"INSERT INTO {table}(user_id,course_id,payload,origin) VALUES($1::uuid,$2::uuid,$3::jsonb,$4) ON CONFLICT(user_id,origin) DO UPDATE SET origin=EXCLUDED.origin RETURNING *", uid, course_id, json.dumps(payload, ensure_ascii=False), origin)
            return decode(row)
        if origin:
            existing = next((x for x in self.base.study_data[kind].values() if x["user_id"] == uid and x["origin"] == origin), None)
            if existing:
                return existing
        row = {"id": str(uuid.uuid4()), "user_id": uid, "course_id": course_id, "payload": payload, "origin": origin, "created_at": utcnow(), "last_reviewed_at": None}
        self.base.study_data[kind][row["id"]] = row
        return row

    async def items(self, kind, uid, course_id=None, limit=200):
        table = {"notes": "study_notes", "bookmarks": "study_bookmarks", "quizzes": "practice_quizzes", "topics": "topic_progress"}[kind]
        if self.pool:
            rows = await self.pool.fetch(f"SELECT * FROM {table} WHERE user_id=$1::uuid AND ($2::uuid IS NULL OR course_id=$2::uuid) ORDER BY created_at DESC LIMIT $3", uid, course_id, limit)
            return [decode(row) for row in rows]
        return [row for row in self.base.study_data[kind].values() if row["user_id"] == uid and (not course_id or row["course_id"] == course_id)][:limit]

    async def get_item(self, kind, item_id, uid):
        table = {"notes": "study_notes", "bookmarks": "study_bookmarks", "quizzes": "practice_quizzes"}[kind]
        if self.pool:
            row = await self.pool.fetchrow(f"SELECT * FROM {table} WHERE id=$1::uuid AND user_id=$2::uuid", item_id, uid)
            return decode(row) if row else None
        row = self.base.study_data[kind].get(item_id)
        return row if row and row["user_id"] == uid else None

    async def remove(self, kind, item_id, uid):
        table = {"notes": "study_notes", "bookmarks": "study_bookmarks"}[kind]
        if not await self.get_item(kind, item_id, uid):
            raise HTTPException(404, "Study item not found.")
        if self.pool:
            await self.pool.execute(f"DELETE FROM {table} WHERE id=$1::uuid AND user_id=$2::uuid", item_id, uid)
        else:
            del self.base.study_data[kind][item_id]

    async def review(self, kind, item_id, uid):
        if kind not in {"bookmarks", "topics"}:
            raise HTTPException(400, "Invalid request.")
        table, key = ("study_bookmarks", "id") if kind == "bookmarks" else ("topic_progress", "topic_key")
        if self.pool:
            # Topic keys include a course prefix, so this cannot review another course by mistake.
            result = await self.pool.execute(f"UPDATE {table} SET last_reviewed_at=now() WHERE {key}::text=$1 AND user_id=$2::uuid", item_id, uid)
            if result.endswith(" 0"):
                raise HTTPException(404, "Study item not found.")
        else:
            rows = self.base.study_data[kind].values()
            row = next((x for x in rows if x["user_id"] == uid and str(x.get(key)) == item_id), None)
            if not row:
                raise HTTPException(404, "Study item not found.")
            row["last_reviewed_at"] = utcnow()

    async def grade(self, quiz_id, uid, question_id, selected):
        if self.pool:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    row = await conn.fetchrow("SELECT * FROM practice_quizzes WHERE id=$1::uuid AND user_id=$2::uuid FOR UPDATE", quiz_id, uid)
                    if not row:
                        raise HTTPException(404, "Quiz not found.")
                    quiz = decode(row)
                    result, changed = grade_payload(quiz["payload"], question_id, selected)
                    if changed:
                        await conn.execute("UPDATE practice_quizzes SET payload=$3::jsonb WHERE id=$1::uuid AND user_id=$2::uuid", quiz_id, uid, json.dumps(quiz["payload"]))
                        q = next(q for q in quiz["payload"]["questions"] if q["id"] == question_id)
                        await conn.execute("""INSERT INTO topic_progress(user_id,course_id,topic_key,title,source_ids,incorrect,attempts,correct_streak,difficulty,last_practiced_at,last_reviewed_at)
                          VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,1,$7,$8,now(),CASE WHEN $9 THEN now() ELSE NULL END)
                          ON CONFLICT(user_id,topic_key) DO UPDATE SET incorrect=topic_progress.incorrect+EXCLUDED.incorrect,
                          attempts=topic_progress.attempts+1,correct_streak=CASE WHEN $9 THEN topic_progress.correct_streak+1 ELSE 0 END,
                          difficulty=greatest(1,least(3,topic_progress.difficulty+CASE WHEN $9 AND topic_progress.correct_streak>=1 THEN 1 WHEN NOT $9 THEN -1 ELSE 0 END)),
                          title=EXCLUDED.title,source_ids=EXCLUDED.source_ids,last_practiced_at=now(),last_reviewed_at=CASE WHEN $9 THEN now() ELSE NULL END""",
                          uid, str(quiz["course_id"]), q["topic_key"], q["topic"], json.dumps(q["source_ids"]), int(not result["correct"]), int(result["correct"]), max(1,q["difficulty"]-(not result["correct"])), result["correct"])
                    return result, quiz, changed
        async with self.base.study_lock:
            quiz = await self.get_item("quizzes", quiz_id, uid)
            if not quiz:
                raise HTTPException(404, "Quiz not found.")
            result, changed = grade_payload(quiz["payload"], question_id, selected)
            if changed:
                q = next(q for q in quiz["payload"]["questions"] if q["id"] == question_id)
                key = (uid, q["topic_key"])
                topic = self.base.study_data["topics"].setdefault(key, {"user_id": uid, "course_id": quiz["course_id"], "topic_key": q["topic_key"], "title": q["topic"], "incorrect": 0, "attempts": 0, "correct_streak": 0, "difficulty": q["difficulty"], "created_at": utcnow()})
                topic.update(source_ids=q["source_ids"], last_practiced_at=utcnow(),last_reviewed_at=utcnow() if result["correct"] else None)
                topic["attempts"] += 1
                topic["incorrect"] += int(not result["correct"])
                topic["correct_streak"] = topic["correct_streak"]+1 if result["correct"] else 0
                topic["difficulty"] = max(1,min(3,topic["difficulty"]+(1 if topic["correct_streak"]>=2 else -1 if not result["correct"] else 0)))
            return result, quiz, changed


def grade_payload(payload, question_id, selected):
    question = next((q for q in payload["questions"] if q["id"] == question_id), None)
    if not question:
        raise HTTPException(404, "Question not found.")
    existing = payload.setdefault("answers", {}).get(question_id)
    if existing:
        if existing["selected"] != selected:
            raise HTTPException(409, "This question has already been answered.")
        return existing, False
    if question.get("kind")=="recall":
        from .intelligence import evaluate_recall
        if not isinstance(selected,str) or not selected.strip() or len(selected)>600:
            raise HTTPException(400,"Enter a short answer.")
        result={"question_id":question_id,"selected":selected,"correct":evaluate_recall(selected,question),"reference_answer":question["reference_answer"],"explanation":question["explanation"],"topic":question["topic"],"topic_key":question["topic_key"],"citations":question["citations"]}
    else:
        if type(selected) is not int:
            raise HTTPException(400,"Choose an answer.")
        if selected < 0 or selected >= len(question["options"]):
            raise HTTPException(400, "Choose an answer.")
        result = {"question_id": question_id, "selected": selected, "correct": selected == question["correct_index"], "correct_index": question["correct_index"], "explanation": question["explanation"], "topic": question["topic"], "topic_key": question["topic_key"], "citations": question["citations"]}
    payload["answers"][question_id] = result
    return result, True
