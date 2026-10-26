from __future__ import annotations

import asyncio
import hmac
import json
import logging
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from .youtube import CaptionError, fetch_captions, fetch_video_title, video_id_from_url
from .video_notes import VIDEO_NOTES_DESCRIPTION, generate_video_notes, notes_clip_bounds, notes_resource_name, uses_video_notes
from .config import get_settings
from .languages import LANGUAGES, LANGUAGE_BY_CODE, language_instruction
from .domain import Interview
from .embeddings import EmbeddingProvider
from .ingestion import make_chunks, parse_document
from .interview import estimate_cost, make_interview, next_question, scorecard
from .providers import LLMProvider
from .retrieval import Retriever, citation_list, context_for, is_overview_question
from .learning_features import (
    BOOKMARK_WEIGHT, DAYS_SINCE_REVIEW_WEIGHT, INCORRECT_WEIGHT,
    MIN_LOCAL_RETRIEVAL_CONFIDENCE, MIN_SEMANTIC_RETRIEVAL_CONFIDENCE,
    ANSWER_SYSTEM_PROMPT, QUIZ_SYSTEM_PROMPT, NOTE_SYSTEM_PROMPT,
    normalize_questions, parse_json_object, public_question, quiz_prompt,
    fallback_question, topic_for, NOTE_USER_PROMPT_TEMPLATE, NOTE_JSON_SCHEMA,
)
from .storage import DEMO_COURSE_ID, MemoryStore, PostgresStore
from .auth import current_user, verify_identity
from .scoped_store import ScopedStore
from .study_store import StudyRepository
from .study import study_router, json_object

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("learning_assistant")
BASE_DIR = Path(__file__).resolve().parents[1]


class CourseInput(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=1000)
    video_url: str | None = Field(default=None, max_length=2048)


class YouTubeInput(BaseModel):
    url: str = Field(min_length=10, max_length=2048)


class TranscriptTextInput(BaseModel):
    text: str = Field(min_length=20, max_length=100_000)


class SessionInput(BaseModel):
    course_id: str


class AskInput(BaseModel):
    course_id: str
    session_id: str | None = None
    question: str = Field(min_length=1, max_length=1800)
    video_time_seconds: int = Field(ge=0, le=86400)
    action: str | None = Field(default=None, max_length=40)
    response_language: str = Field(default="en", max_length=16)
    allow_broader: bool = False
    general_knowledge: bool = False

    @field_validator("response_language")
    @classmethod
    def validate_response_language(cls, value: str) -> str:
        if value != "auto" and value not in LANGUAGE_BY_CODE:
            raise ValueError("Choose a supported answer language or auto.")
        return value


class InterviewInput(BaseModel):
    role: str = Field(min_length=2, max_length=160)
    skill_level: str = Field(default="intermediate", max_length=40)
    interview_type: str = Field(default="mixed", max_length=40)
    duration_minutes: int = Field(default=10, ge=10, le=30)
    resume_text: str = Field(default="", max_length=16000)
    job_description: str = Field(default="", max_length=16000)
    course_id: str | None = None
    response_language: str = Field(default="en", max_length=16)

    @field_validator("response_language")
    @classmethod
    def validate_response_language(cls, value: str) -> str:
        return AskInput.validate_response_language(value)


class InterviewTurnInput(BaseModel):
    answer: str = Field(min_length=1, max_length=5000)
    response_language: str | None = Field(default=None, max_length=16)

    @field_validator("response_language")
    @classmethod
    def validate_response_language(cls, value: str | None) -> str | None:
        return AskInput.validate_response_language(value) if value is not None else None


class QuizInput(BaseModel):
    course_id: str
    video_time_seconds: int = Field(ge=0, le=86400)
    topic: str | None = Field(default=None, max_length=120)
    response_language: str = Field(default="en", max_length=16)

    @field_validator("response_language")
    @classmethod
    def validate_response_language(cls, value: str) -> str:
        return AskInput.validate_response_language(value)


class QuizAttemptInput(BaseModel):
    course_id: str
    question_id: str
    selected_index: int = Field(ge=0, le=3)


class BookmarkInput(BaseModel):
    course_id: str
    source_id: str
    source_type: Literal["video", "pdf", "ppt"]
    resource_name: str = Field(min_length=1, max_length=240)
    location: dict[str, Any]
    note: str = Field(default="", max_length=1000)
    saved_explanation: str = Field(default="", max_length=5000)
    concept_tags: list[str] = Field(default_factory=list, max_length=20)


class BookmarkEditInput(BaseModel):
    course_id: str
    note: str | None = Field(default=None, max_length=1000)
    saved_explanation: str | None = Field(default=None, max_length=5000)
    concept_tags: list[str] | None = Field(default=None, max_length=20)


class RevisionNoteInput(BaseModel):
    course_id: str
    topic: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=2000)
    key_points: list[str] = Field(default_factory=list, max_length=12)


class RevisionInput(BaseModel):
    course_id: str
    topic: str = Field(min_length=1, max_length=120)


class AppState:
    store: Any = None
    embedder: EmbeddingProvider | None = None
    llm: LLMProvider | None = None
    retriever: Retriever | None = None
    rate_events: dict[str, deque[float]] = defaultdict(deque)


state = AppState()
# Keep quiz practice available if the production database has not yet received
# migration 003. These short-lived records last only for this backend process.
volatile_quizzes: dict[str, dict[str, Any]] = {}
volatile_quiz_attempts: dict[str, list[dict[str, Any]]] = defaultdict(list)


async def seed_sample_course(store, embedder: EmbeddingProvider) -> None:
    courses = await store.list_courses()
    if courses:
        return
    course = await store.add_course(
        "RAG Foundations (sample lesson)",
        "A short, timestamped lesson about embeddings, hybrid retrieval and reranking. Use the demo timeline to explore future-content protection.",
        course_id=DEMO_COURSE_ID,
    )
    sample_dir = BASE_DIR / "data" / "sample"
    for filename in ("lesson.vtt", "supporting-notes.md"):
        raw = (sample_dir / filename).read_bytes()
        source_type, rows = await run_in_threadpool(parse_document, filename, raw)
        chunks = await make_chunks(course["id"], "", filename, source_type, rows, embedder)
        await store.add_resource(course["id"], filename, source_type, chunks)
    logger.info("Seeded sample course id=%s", course["id"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.app_env.lower() == "production":
        missing = []
        if not settings.app_api_key:
            missing.append("APP_API_KEY")
        if not settings.database_url:
            missing.append("DATABASE_URL")
        if not settings.supabase_url or not settings.supabase_publishable_key:
            missing.append("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY")
        if settings.llm_provider.lower() == "mock":
            missing.append("LLM_PROVIDER (choose gemini, openai, or bedrock)")
        if missing:
            raise RuntimeError("Production configuration is incomplete: " + ", ".join(missing))
    state.embedder = EmbeddingProvider(settings)
    state.llm = LLMProvider(settings)
    if settings.database_url:
        state.store = await PostgresStore.connect(settings.database_url)
        logger.info("Using PostgreSQL/Supabase repository")
    else:
        state.store = MemoryStore()
        logger.warning("DATABASE_URL is unset; using process-local demo storage")
    await seed_sample_course(state.store, state.embedder)
    state.retriever = Retriever(state.store, state.embedder)
    yield
    if state.store:
        await state.store.close()


app = FastAPI(
    title="AI Learning Assistant API",
    description="Timestamp-aware learning RAG, course ingestion, and adaptive mock interviews.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


@app.middleware("http")
async def secure_api_requests(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))[:100]
    request.state.request_id = request_id
    path = request.url.path
    if path.startswith("/api/v1/"):
        expected = settings.app_api_key
        if expected:
            supplied = request.headers.get("authorization", "")
            token = supplied.removeprefix("Bearer ")
            if not supplied.startswith("Bearer ") or not hmac.compare_digest(token, expected):
                return JSONResponse(status_code=401, content={"detail": "Unauthorized", "request_id": request_id})
        if settings.supabase_url and path not in {"/api/v1/languages", "/api/v1/status"}:
            try:
                user = await verify_identity(request.headers.get("x-user-token", ""), settings, StudyRepository(state.store))
            except HTTPException as exc:
                return JSONResponse(status_code=exc.status_code,content={"detail":exc.detail})
            request.state.identity = user
        # In-process fallback limiter; put an edge/API-gateway limiter in front when running multiple replicas.
        identity = getattr(request.state, "identity", None)
        client = identity.id if identity else (request.client.host if request.client else "unknown")
        now = time.monotonic()
        events = state.rate_events[client]
        while events and now - events[0] > settings.rate_limit_window_seconds:
            events.popleft()
        if len(events) >= settings.rate_limit_requests:
            return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded", "request_id": request_id}, headers={"Retry-After": str(settings.rate_limit_window_seconds)})
        events.append(now)
    context_token = current_user.set(getattr(request.state, "identity", None))
    try:
        response = await call_next(request)
    finally:
        current_user.reset(context_token)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    logger.exception("Unhandled request error request_id=%s", request_id)
    return JSONResponse(status_code=500, content={"detail": "The request could not be completed.", "request_id": request_id})


def ready_store():
    if state.store is None:
        raise HTTPException(status_code=503, detail="Application is starting")
    user = current_user.get()
    return ScopedStore(state.store, user) if user else state.store


def check_upload_size(raw: bytes):
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds the {settings.max_upload_mb} MB upload limit")


@app.get("/health")
async def health():
    return {"status": "ok", "storage": "postgres" if settings.database_url else "demo-memory", "llm_provider": settings.llm_provider}


@app.get("/api/v1/courses")
async def list_courses(store=Depends(ready_store)):
    return {"courses": await store.list_courses()}


@app.get("/api/v1/languages")
async def answer_languages():
    return {"languages": LANGUAGES, "automatic": "auto"}


@app.get("/api/v1/status")
async def model_status():
    return {"llm_provider": settings.llm_provider, "embedding_provider": settings.embedding_provider}


@app.post("/api/v1/courses", status_code=201)
async def create_course(payload: CourseInput, store=Depends(ready_store)):
    video_url = None
    if payload.video_url:
        try:
            video_id = video_id_from_url(payload.video_url)
        except CaptionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        video_url = f"https://www.youtube.com/watch?v={video_id}"
    return await store.add_course(payload.title, payload.description, video_url)


# Serialize imports to avoid repeated fetches for the same URL in one worker.
youtube_import_lock = asyncio.Lock()


@app.post("/api/v1/videos/youtube/import")
async def import_youtube(payload: YouTubeInput, store=Depends(ready_store)):
    try:
        video_id = video_id_from_url(payload.url)
    except CaptionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    canonical_url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        async with asyncio.timeout(100):
            async with youtube_import_lock:
                existing = next((course for course in await store.list_courses() if course.get("video_url") == canonical_url), None)
                if existing and (uses_video_notes(existing) or await store.covered_chunks(existing["id"], 86400, 1)):
                    return {"course": existing, "cached": True, "status": "awaiting_analysis" if uses_video_notes(existing) else "ready", "source": "gemini_video" if uses_video_notes(existing) else "captions"}
                try:
                    imported = await run_in_threadpool(fetch_captions, video_id)
                    # A whole long lecture can exceed embedding quotas and the
                    # request deadline. Use bounded watched-clip analysis instead.
                    if settings.gemini_api_key and len(imported["rows"]) > 64:
                        imported = None
                except CaptionError:
                    if not settings.gemini_api_key:
                        raise
                    imported = None
                if imported is None:
                    # A silent intro or a blocked caption endpoint must not stop
                    # the learner from attaching the video. Analyze a watched clip
                    # only when they ask, in any detected spoken language.
                    title = await run_in_threadpool(fetch_video_title, video_id)
                    course = await store.add_course(
                        title, VIDEO_NOTES_DESCRIPTION + ". Language is detected automatically; only analyzed clips are covered.", canonical_url
                    )
                    return {"course": course, "cached": False, "status": "awaiting_analysis", "source": "gemini_video", "language": "Auto-detected", "generated": True, "chunk_count": 0}
                video_notes = imported.get("source") == "gemini_video"
                resource_name = notes_resource_name(0, 60) if video_notes else f"youtube-{video_id}.vtt"
                # Finish parsing/embedding before publishing a course. Failed fetches leave no course behind.
                chunks = await make_chunks("", "", resource_name, "video", imported["rows"], state.embedder)
                description = VIDEO_NOTES_DESCRIPTION + ". Only analyzed clips are covered; notes and timing are approximate." if video_notes else f"Imported {imported['language']} YouTube captions"
                course = await store.add_course(imported["title"], description, canonical_url)
                for chunk in chunks:
                    chunk.course_id = course["id"]
                try:
                    resource = await store.add_resource(course["id"], resource_name, "video", chunks)
                except BaseException:
                    # Includes cancellation at the request deadline.
                    await asyncio.shield(store.clear_video_url(course["id"]))
                    raise
                return {"course": course, "cached": False, "status": "ready", "source": "gemini_video" if video_notes else "captions", "language": imported["language"], "generated": imported["generated"], "chunk_count": resource["chunk_count"]}
    except CaptionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Caption import took too long. Retry in a moment.") from exc


@app.post("/api/v1/courses/{course_id}/resources", status_code=201)
async def ingest_resource(course_id: str, file: UploadFile = File(...), store=Depends(ready_store)):
    if not await store.get_course(course_id):
        raise HTTPException(status_code=404, detail="Course not found")
    if isinstance(store, ScopedStore):
        await store.writable_course(course_id)
    filename = Path(file.filename or "upload").name
    raw = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    check_upload_size(raw)
    try:
        source_type, rows = await run_in_threadpool(parse_document, filename, raw)
        chunks = await make_chunks(course_id, "", filename, source_type, rows, state.embedder)
        resource = await store.add_resource(course_id, filename, source_type, chunks)
        if getattr(store, "pool", None):
            import mimetypes
            await store.pool.execute("INSERT INTO resource_files(resource_id,filename,content_type,content) VALUES($1::uuid,$2,$3,$4) ON CONFLICT(resource_id) DO UPDATE SET filename=EXCLUDED.filename,content_type=EXCLUDED.content_type,content=EXCLUDED.content", resource["id"],filename,mimetypes.guess_type(filename)[0] or "application/octet-stream",raw)
        return resource
    except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Ingestion failed for resource=%s", filename)
        raise HTTPException(status_code=422, detail="The file could not be extracted. Check its format and contents.") from exc


@app.post("/api/v1/courses/{course_id}/transcripts", status_code=201)
async def ingest_pasted_transcript(course_id: str, payload: TranscriptTextInput, store=Depends(ready_store)):
    if not await store.get_course(course_id):
        raise HTTPException(status_code=404, detail="Course not found")
    if isinstance(store, ScopedStore):
        await store.writable_course(course_id)
    try:
        rows = await run_in_threadpool(parse_document, "pasted-transcript.txt", payload.text.encode("utf-8"))
        source_type, segments = rows
        if source_type != "video":
            raise ValueError("No timestamps found. Include times such as [00:00:00] before each caption.")
        chunks = await make_chunks(course_id, "", "Pasted video transcript", "video", segments, state.embedder)
        return await store.add_resource(course_id, "Pasted video transcript", "video", chunks)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Pasted transcript ingestion failed for course=%s", course_id)
        raise HTTPException(status_code=422, detail="The transcript could not be processed. Check its timestamp format and try again.") from exc


@app.post("/api/v1/learning/sessions", status_code=201)
async def create_learning_session(payload: SessionInput, store=Depends(ready_store)):
    if not await store.get_course(payload.course_id):
        raise HTTPException(status_code=404, detail="Course not found")
    return await store.create_session(payload.course_id)




async def ensure_watched_notes(course, video_time_seconds, store):
    # Analyze a bounded, already-watched clip. Do not pass the full video to the answer model.
    if uses_video_notes(course) and video_time_seconds > 0:
        start, end = notes_clip_bounds(video_time_seconds)
        name = notes_resource_name(start, end)
        covered = await store.covered_chunks(course["id"], end, 120)
        if any(row.get("source_type")=="video" and str(row.get("resource_name","")).startswith("youtube-") for row in covered):
            return
        if not any(row.get("resource_name") == name for row in covered):
            try:
                imported = await generate_video_notes(course["video_url"], start, end, settings)
                chunks = await make_chunks(course["id"], "", name, "video", imported["rows"], state.embedder)
                await store.add_resource(course["id"], name, "video", chunks)
            except CaptionError as exc:
                if any(row.get("source_type")=="video" for row in covered):
                    return
                raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/learning/ask")
async def ask(payload: AskInput, store=Depends(ready_store)):
    if payload.general_knowledge:
        payload.allow_broader = True
    course = await store.get_course(payload.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if payload.session_id:
        if not await store.session_belongs_to_course(payload.session_id, payload.course_id):
            raise HTTPException(status_code=404, detail="Learning session not found for this course")
        session_id = payload.session_id
    else:
        session_id = (await store.create_session(payload.course_id))["id"]
    await ensure_watched_notes(course, payload.video_time_seconds, store)
    history = await store.get_messages(session_id, 8)
    if payload.allow_broader:
        previous = next((m for m in reversed(history) if m["role"] == "assistant"), {})
        meta = previous.get("metadata", {})
        if meta.get("refusal_reason") != "unsupported_by_resources" or meta.get("question") != payload.question:
            raise HTTPException(409, "Ask the course guide first before requesting a broader explanation.")
        answer = await state.llm.generate("Give a concise general educational explanation. Clearly state that this is general knowledge, not verified against the learner's course. Do not invent citations or claim the course covers this. " + language_instruction(payload.response_language), payload.question, allow_fallback=False)
        message_id = await store.append_message(session_id,"assistant",answer,{"course_id":payload.course_id,"question":payload.question,"answer_mode":"broader","citations":[],"video_time_seconds":payload.video_time_seconds,"response_language":payload.response_language})
        return {"session_id":session_id,"message_id":message_id,"answer":answer,"citations":[],"answer_mode":"broader","knowledge_scope":"general","general_knowledge_available":False,"response_language":payload.response_language,"video_time_seconds":payload.video_time_seconds,"refusal_reason":None}
    action = (payload.action or "answer").lower()
    if action == "answer" and is_overview_question(payload.question):
        action = "summary"
    focus_question = payload.question
    generic_action_without_history = False
    if action in {"simplify", "example", "where"}:
        previous_question = next((item["content"] for item in reversed(history) if item["role"] == "user"), None)
        generic_questions = {"Quiz me on concepts covered so far", "Summarize what I have learned so far", "Compare the concepts covered so far", "Explain the idea in simpler words", "Give me a practical example", "Where was this discussed?"}
        if previous_question and previous_question not in generic_questions and not is_overview_question(previous_question):
            focus_question = previous_question
        else:
            generic_action_without_history = True
    latest_user_question = next((item["content"] for item in reversed(history) if item["role"] == "user"), "")
    referential = any(token in payload.question.lower().split() for token in ("it", "that", "this", "they", "them", "those")) or len(payload.question.split()) <= 4
    retrieval_question = f"{latest_user_question} {payload.question}".strip() if latest_user_question and referential else focus_question
    try:
        if (action in {"summary", "quiz"} or (action == "compare" and payload.question == "Compare the concepts covered so far")) or is_overview_question(focus_question) or generic_action_without_history:
            matches, future = await state.retriever.covered(payload.course_id, payload.video_time_seconds), None
        else:
            matches, future = await state.retriever.retrieve(payload.course_id, retrieval_question, payload.video_time_seconds)
    except Exception as exc:
        logger.exception("Learning retrieval failed")
        raise HTTPException(status_code=503, detail="The course search service is temporarily unavailable. Please retry in a moment.") from exc
    confidence = max((float(item.get("semantic_score", item.get("score", 1)) or 0) for item in matches), default=0.0)
    semantic = any("semantic_score" in item for item in matches)
    threshold = MIN_SEMANTIC_RETRIEVAL_CONFIDENCE if semantic else MIN_LOCAL_RETRIEVAL_CONFIDENCE
    if confidence < threshold:
        matches = []
    citations = citation_list(matches)
    concept_note = None
    refusal_reason = None
    knowledge_scope = "course"
    if payload.general_knowledge:
        knowledge_scope = "general"
        try:
            answer = await state.llm.generate(
                "Answer from general knowledge only. Explicitly label the response as not from the learner's material. Do not claim course citations. " + language_instruction(payload.response_language),
                "GENERAL_KNOWLEDGE_FALLBACK\nLabel: Not from your material\nLearner question: " + payload.question,
                allow_fallback=False,
            )
            answer = "Not from your material\n\n" + answer.removeprefix("Not from your material").strip()
            citations = []
        except Exception as exc:
            logger.exception("General knowledge response failed")
            raise HTTPException(status_code=503, detail="The configured language model is unavailable. Check provider credentials and retry.") from exc
    elif not matches and course.get("video_url") and payload.video_time_seconds == 0:
        answer = "The video is ready. Play it first, then ask about the part you have watched."
        refusal_reason = "not_started"
    elif not matches and future:
        answer = "That topic appears later in the lecture and hasn't been covered at your current position yet. I can explain it once you reach that section."
        refusal_reason = "future_video_content"
    elif not matches:
        answer = "I couldn't find support for that in the available course resources at this point, so I don't want to guess."
        refusal_reason = "unsupported_by_resources"
    else:
        action_guidance = {
            "simplify": "Explain in simpler words, defining jargon.",
            "example": "Give one concrete example or analogy grounded in the sources.",
            "where": "Point to where the idea was discussed, using the citations.",
            "summary": "Summarize the concepts represented by these sampled watched passages. The samples span the watched portion but are not a complete transcript; do not imply exhaustive coverage.",
            "quiz": "Create three short practice questions about the programming or subject concepts supported by the sources, with concise answer keys. Test understanding of concepts, not chapter numbers, presenter names, or video navigation. Ignore garbled speech; if fewer concepts are supported, give fewer useful questions.",
            "compare": "Compare the ideas named in the learner's question only where the sources support the comparison.",
            "answer": "Answer the learner's question directly.",
        }.get(action, "Answer the learner's question directly.")
        structured = isinstance(store, ScopedStore)
        prompt = "\n".join([
            "GROUNDED_LEARNING_ANSWER",
            'Return ONLY JSON {"answer":"localized answer using [S1] labels","supported":true,"sources":["S1"],"concept":"localized concept title","revision_note":"short important concept explanation supported by the same sources"}. Set supported=false, sources=[], and revision_note="" if the material cannot answer. Never treat a merely related passage as supporting evidence.' if structured else "",
            f"COURSE: {course['title']}",
            f"LEARNER_VIDEO_POSITION_SECONDS: {payload.video_time_seconds}",
            f"ACTION: {action_guidance}",
            "CONVERSATION HISTORY (short follow-up context only):",
            *[f"{item['role']}: {item['content']}" for item in history],
            f"LEARNER QUESTION: {focus_question}",
            "AI video notes are approximate and cover only analyzed clips. If notes are used, acknowledge this limitation; a summary is of the analyzed section, not the whole video." if uses_video_notes(course) else "",
            "Spoken captions may omit code punctuation, brackets, or subscripts. Do not reconstruct executable code from speech. Use conceptual explanations and plain-language quiz questions unless a source contains unambiguous code. In particular, an assignment to a variable is different from modifying an element inside a container; do not turn spoken item-assignment examples into variable-assignment examples.",
            language_instruction(payload.response_language),
            "ALLOWED SOURCES:",
            context_for(matches, max_chars=24000),
            "Sources may be in Hindi or another language. Understand their meaning and follow the OUTPUT LANGUAGE instruction. Ignore repetition or unintelligible fragments. Answer only from the allowed source text. If the evidence does not support a claim, say so. Mention source labels [S1], [S2] when useful. Never infer or reveal later-video material.",
        ])
        try:
            answer = await state.llm.generate(
                ANSWER_SYSTEM_PROMPT + " " + language_instruction(payload.response_language),
                prompt,
                allow_fallback=False,
            )
        except Exception as exc:
            logger.exception("LLM provider failed")
            raise HTTPException(status_code=503, detail="The configured language model is unavailable. Check provider credentials and retry.") from exc
        if structured:
            try:
                result = json_object(answer)
                answer = str(result.get("answer", "")).strip()
                supported_indices = list(dict.fromkeys(int(value[1:])-1 for value in result.get("sources", []) if isinstance(value,str) and __import__("re").fullmatch(r"S[1-9][0-9]*",value) and 1<=int(value[1:])<=len(matches)))
                if result.get("supported") is not True or not supported_indices:
                    answer = "I couldn't find support for that in the available course resources at this point, so I don't want to guess."
                    citations = []
                    refusal_reason = "unsupported_by_resources"
                else:
                    citations = [{**citation_list([matches[i]])[0], "source_label":f"S{i+1}"} for i in supported_indices]
                    if result.get("revision_note") and result.get("concept"):
                        concept_note = {"title":str(result["concept"])[:160],"content":str(result["revision_note"])[:4000]}
            except (ValueError, TypeError, KeyError) as exc:
                raise HTTPException(503, "The answer could not be verified against its sources. Please retry.") from exc
        if not answer.strip():
            answer = "I couldn't produce a grounded answer from the current course material."
            citations = []
            refusal_reason = "empty_model_response"
        else:
            import re
            answer = re.sub(r"\[(S\d+)\]", lambda match: match.group(0) if int(match.group(1)[1:]) <= len(matches) else "", answer)
    if refusal_reason and payload.response_language != "en":
        try:
            answer = await state.llm.generate(
                "Translate the approved status message only. Preserve its meaning and do not answer the course question or add any facts. " + language_instruction(payload.response_language),
                json.dumps({"learner_question_for_language_only": payload.question, "approved_status_message": answer}, ensure_ascii=False),
                max_tokens=300, allow_fallback=False,
            )
            if not answer.strip():
                raise ValueError("Empty localized status")
        except Exception as exc:
            raise HTTPException(status_code=503, detail="The answer language service is temporarily unavailable. Please retry.") from exc
    await store.append_message(session_id, "user", payload.question)
    message_id = None
    if isinstance(store, ScopedStore):
        metadata = {"course_id":payload.course_id,"question":payload.question,"citations":citations,"video_time_seconds":payload.video_time_seconds,"response_language":payload.response_language,"refusal_reason":refusal_reason,"answer_mode":"grounded"}
        message_id = await store.append_message(session_id,"assistant",answer,metadata)
        repository = StudyRepository(store)
        if concept_note and not refusal_reason and (await repository.profile(store.user.id))["auto_notes"]:
            await repository.insert_item("notes",store.user.id,payload.course_id,{**concept_note,"citations":citations,"video_time_seconds":payload.video_time_seconds,"kind":"concept","response_language":payload.response_language},origin=f"message:{message_id}")
    else:
        await store.append_message(session_id, "assistant", answer)
    return {
        "message_id": message_id,
        "answer_mode": "grounded",
        "session_id": session_id,
        "answer": answer,
        "citations": citations,
        "retrieved_chunks": len(matches),
        "video_time_seconds": payload.video_time_seconds,
        "response_language": payload.response_language,
        "refusal_reason": refusal_reason,
        "confidence": round(confidence, 4),
        "general_knowledge_available": refusal_reason == "unsupported_by_resources",
        "knowledge_scope": knowledge_scope,
        "future_section": ({"start_time": future.get("start_time"), "resource_name": future.get("resource_name")} if future else None),
    }


@app.post("/api/v1/learning/quiz")
async def create_adaptive_quiz(payload: QuizInput, store=Depends(ready_store)):
    course = await store.get_course(payload.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    # Video-note courses are analyzed lazily as the learner watches. Make sure
    # quiz generation analyzes the clip at this playhead too; otherwise a quiz
    # could be built only from an older cached clip (or unrelated notes).
    if uses_video_notes(course) and payload.video_time_seconds > 0:
        start, end = notes_clip_bounds(payload.video_time_seconds)
        name = notes_resource_name(start, end)
        covered = await store.covered_chunks(payload.course_id, end, 120)
        video_id = video_id_from_url(course["video_url"])
        captions_name = f"youtube-{video_id}.vtt"
        has_timestamped_captions = any(
            row.get("source_type") == "video" and row.get("resource_name") == captions_name
            for row in covered
        )
        if not has_timestamped_captions and not any(row.get("resource_name") == name for row in covered):
            try:
                imported = await generate_video_notes(course["video_url"], start, end, settings)
                chunks = await make_chunks(payload.course_id, "", name, "video", imported["rows"], state.embedder)
                await store.add_resource(payload.course_id, name, "video", chunks)
            except CaptionError as exc:
                # A transient Gemini video-analysis failure should not discard
                # earlier material already covered by the learner's playhead.
                logger.warning("Video clip analysis failed for quiz course=%s at=%s: %s", payload.course_id, end, exc)
                try:
                    imported = await run_in_threadpool(fetch_captions, video_id)
                    chunks = await make_chunks(payload.course_id, "", captions_name, "video", imported["rows"], state.embedder)
                    await store.add_resource(payload.course_id, captions_name, "video", chunks)
                    has_timestamped_captions = True
                except CaptionError as caption_exc:
                    logger.info("YouTube caption fallback unavailable for quiz course=%s: %s", payload.course_id, caption_exc)
    chunks = await store.study_chunks(payload.course_id, payload.video_time_seconds, 120)
    chunks = [chunk for chunk in chunks if str(chunk.get("content", "")).strip()]
    # When a lesson has a linked video, a video quiz must stay with its video
    # transcript/notes. Supporting PDFs remain available to chat and citations,
    # but must not silently change the topic of a video quiz.
    if course.get("video_url"):
        video_chunks = [chunk for chunk in chunks if chunk.get("source_type") == "video"]
        if video_chunks:
            chunks = video_chunks
    if payload.topic:
        terms = set(payload.topic.lower().split())
        filtered = [chunk for chunk in chunks if terms.intersection(str(chunk.get("content", "")).lower().split())]
        if filtered:
            chunks = filtered
    if not chunks:
        if uses_video_notes(course) and payload.video_time_seconds > 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    "There is no transcript or analyzed video material available up to this point yet. "
                    "Upload this video's timestamped VTT/SRT transcript under Supporting materials, "
                    "or retry after video analysis is available."
                ),
            )
        raise HTTPException(status_code=409, detail="Add or watch course material before generating a quiz.")
    # Keep the no-topic path blank so the model derives a real concept from the
    # retrieved lesson text instead of treating prompt boilerplate as content.
    prompt, source_map = quiz_prompt(chunks, 5, payload.topic or "", 2)
    try:
        raw = await state.llm.generate(QUIZ_SYSTEM_PROMPT + "\n" + language_instruction(payload.response_language), prompt, max_tokens=1800, allow_fallback=False)
        questions = normalize_questions(parse_json_object(raw), source_map, 5, payload.topic or "", 2)
    except Exception as exc:
        logger.warning("Quiz model unavailable; using deterministic source-backed questions: %s", exc)
        questions = []
    if not questions:
        questions = [fallback_question(chunks[index % len(chunks)], payload.topic or topic_for(chunks[index % len(chunks)].get("content", "")), 2) for index in range(5)]
    try:
        quiz = await store.create_quiz(payload.course_id, payload.video_time_seconds, questions)
    except Exception:
        logger.exception("Quiz persistence unavailable; keeping this quiz in process memory")
        quiz = {"id": str(uuid.uuid4()), "course_id": payload.course_id, "video_time_seconds": payload.video_time_seconds, "questions": questions}
        volatile_quizzes[quiz["id"]] = {**quiz,"owner_id":current_user.get().id if current_user.get() else "demo"}
    return {"quiz_id": quiz["id"], "questions": [public_question(question) for question in questions]}


@app.post("/api/v1/learning/quiz/{quiz_id}/answer")
async def answer_quiz_question(quiz_id: str, payload: QuizAttemptInput, store=Depends(ready_store)):
    quiz = volatile_quizzes.get(quiz_id)
    if quiz and quiz.get("owner_id") != (current_user.get().id if current_user.get() else "demo"):
        quiz = None
    if not quiz:
        quiz = await store.get_quiz(quiz_id, payload.course_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    question = next((row for row in quiz.get("questions", []) if row.get("id") == payload.question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    correct = payload.selected_index == int(question["correct_index"])
    topic = str(question.get("topic") or "Course review")
    difficulty = int(question.get("difficulty") or 2)
    attempt = {"course_id": payload.course_id, "quiz_id": quiz_id, "question_id": payload.question_id,
               "topic": topic, "correct": correct, "difficulty": difficulty,
               "selected_index": payload.selected_index, "citation": question.get("citation", {})}
    try:
        await store.record_quiz_attempt(attempt)
    except Exception:
        logger.exception("Quiz attempt persistence unavailable; keeping this answer in process memory")
        volatile_quiz_attempts[(current_user.get().id if current_user.get() else "demo")+":"+payload.course_id].append({**attempt, "created_at": datetime.now(timezone.utc).isoformat()})
    response: dict[str, Any] = {"correct": correct, "topic": topic, "difficulty": difficulty}
    if not correct:
        response["explanation"] = question.get("explanation", "Review the cited passage and try this concept again.")
        response["citation"] = question.get("citation")
    try:
        attempts = (await store.get_feature_data(payload.course_id))["attempts"]
    except Exception:
        logger.exception("Quiz history unavailable; using process-memory answers")
        attempts = []
    attempts.extend(volatile_quiz_attempts[(current_user.get().id if current_user.get() else "demo")+":"+payload.course_id])
    recent = [row for row in attempts if row.get("topic", "").casefold() == topic.casefold()][-2:]
    next_difficulty = max(1, difficulty - 1) if not correct else min(3, difficulty + 1) if len(recent) == 2 and all(item.get("correct") for item in recent) else difficulty
    if not correct or (len(recent) == 2 and all(item.get("correct") for item in recent)):
        citation = question.get("citation") or {}
        excerpt = citation.get("quote", "")
        chunk = {"id": question.get("chunk_id"), "resource_id": citation.get("source_id"), "source_type": citation.get("source_type"),
                 "resource_name": citation.get("resource_name"), "start_time": citation.get("start_seconds"), "end_time": citation.get("end_seconds"),
                 "page_number": citation.get("page"), "slide_number": citation.get("slide"), "content": excerpt}
        adaptive_prompt, adaptive_sources = quiz_prompt([chunk], 1, topic, next_difficulty)
        try:
            raw = await state.llm.generate(QUIZ_SYSTEM_PROMPT, adaptive_prompt, max_tokens=500, allow_fallback=False)
            adaptive_rows = normalize_questions(parse_json_object(raw), adaptive_sources, 1, topic, next_difficulty)
            adaptive = adaptive_rows[0]
        except Exception:
            adaptive = fallback_question(chunk, topic, next_difficulty)
        try:
            await store.add_quiz_question(quiz_id, adaptive)
        except Exception:
            logger.exception("Adaptive quiz persistence unavailable; keeping the follow-up in process memory")
            quiz = volatile_quizzes.setdefault(quiz_id, {**quiz,"owner_id":current_user.get().id if current_user.get() else "demo", "questions": list(quiz.get("questions", []))})
            quiz["questions"].append(adaptive)
        response["next_question"] = public_question(adaptive)
    return response


@app.get("/api/v1/learning/progress")
async def learning_progress(course_id: str, store=Depends(ready_store)):
    if not await store.get_course(course_id):
        raise HTTPException(status_code=404, detail="Course not found")
    data = await store.get_feature_data(course_id)
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for attempt in data["attempts"]:
        grouped[str(attempt.get("topic") or "Course review")].append(attempt)
    weak = []
    for topic, rows in grouped.items():
        wrong = sum(not row.get("correct") for row in rows)
        right = len(rows) - wrong
        if wrong and wrong >= right:
            weak.append({"topic": topic, "incorrect_count": wrong, "correct_count": right, "accuracy": round(right / len(rows), 2), "last_attempt": rows[-1].get("created_at")})
    weak.sort(key=lambda row: (-row["incorrect_count"], row["topic"].casefold()))
    return {"weak_topics": weak}


@app.get("/api/v1/learning/revision-queue")
async def revision_queue(course_id: str, store=Depends(ready_store)):
    data = await store.get_feature_data(course_id)
    stats: dict[str, dict[str, Any]] = defaultdict(lambda: {"incorrect_count": 0, "last_reviewed": None, "bookmark_count": 0, "sources": []})
    for attempt in data["attempts"]:
        row = stats[str(attempt.get("topic") or "Course review")]
        row["incorrect_count"] += int(not attempt.get("correct"))
        row["last_reviewed"] = attempt.get("created_at")
        citation = attempt.get("citation") or {}
        if citation.get("source_id"):
            location = {"seconds": citation.get("start_seconds")} if citation.get("source_type") == "video" else {"page": citation.get("page")} if citation.get("source_type") == "pdf" else {"slide": citation.get("slide")}
            row["sources"].append({"source_id": citation.get("source_id"), "source_type": citation.get("source_type"), "resource_name": citation.get("resource_name"), "location": location})
    for bookmark in data["bookmarks"]:
        topics = bookmark.get("concept_tags") or [topic_for(bookmark.get("saved_explanation") or bookmark.get("note") or bookmark.get("resource_name", "Course review"))]
        for topic in topics:
            row = stats[str(topic)]
            row["bookmark_count"] += 1
            row["sources"].append(bookmark)
    now = time.time()
    reviews = {str(row["topic"]).casefold(): row.get("last_reviewed") for row in data["reviews"]}
    queue = []
    for topic, row in stats.items():
        last = reviews.get(topic.casefold()) or row.get("last_reviewed")
        try:
            days = max(0, int((now - __import__("datetime").datetime.fromisoformat(str(last).replace("Z", "+00:00")).timestamp()) / 86400)) if last else 0
        except (ValueError, TypeError):
            days = 0
        score = row["incorrect_count"] * INCORRECT_WEIGHT + days * DAYS_SINCE_REVIEW_WEIGHT + row["bookmark_count"] * BOOKMARK_WEIGHT
        reasons = []
        if row["incorrect_count"]: reasons.append(f"{row['incorrect_count']} wrong answers")
        if days: reasons.append(f"last reviewed {days} days ago")
        if row["bookmark_count"]: reasons.append(f"{row['bookmark_count']} saved bookmark(s)")
        queue.append({"topic": topic, "priority": score, "reason": ", ".join(reasons) or "Saved course concept", "incorrect_count": row["incorrect_count"], "days_since_last_review": days, "bookmark_count": row["bookmark_count"], "source": row["sources"][0] if row["sources"] else None})
    queue.sort(key=lambda row: (-row["priority"], row["topic"].casefold()))
    return {"revise_next": queue[0] if queue else None, "items": queue,
            "weights": {"incorrect": INCORRECT_WEIGHT, "days_since_review": DAYS_SINCE_REVIEW_WEIGHT, "bookmark": BOOKMARK_WEIGHT}}


@app.post("/api/v1/learning/revision-queue/revised")
async def mark_topic_revised(payload: RevisionInput, store=Depends(ready_store)):
    return await store.mark_revised(payload.course_id, payload.topic)


@app.get("/api/v1/learning/bookmarks")
async def list_bookmarks(course_id: str, store=Depends(ready_store)):
    return {"bookmarks": await store.list_bookmarks(course_id)}


@app.post("/api/v1/learning/bookmarks", status_code=201)
async def create_bookmark(payload: BookmarkInput, store=Depends(ready_store)):
    if not await store.get_course(payload.course_id):
        raise HTTPException(status_code=404, detail="Course not found")
    location = payload.location
    position = location.get("seconds") if payload.source_type == "video" else location.get("page" if payload.source_type == "pdf" else "slide")
    if not isinstance(position, int) or position < 0:
        raise HTTPException(status_code=422, detail="Bookmark location must include seconds, page, or slide.")
    chunks = await store.get_location_chunks(payload.course_id, payload.source_id, payload.source_type, position)
    if not chunks:
        raise HTTPException(status_code=404, detail="No uploaded source passage exists at that location.")
    bookmark = {**payload.model_dump(), "created_at": datetime.now(timezone.utc).isoformat()}
    bookmark["concept_tags"] = [tag[:100] for tag in payload.concept_tags]
    return await store.save_bookmark(bookmark)


@app.patch("/api/v1/learning/bookmarks/{bookmark_id}")
async def edit_bookmark(bookmark_id: str, payload: BookmarkEditInput, store=Depends(ready_store)):
    row = await store.update_bookmark(bookmark_id, payload.course_id, payload.model_dump(exclude={"course_id"}, exclude_unset=True))
    if not row: raise HTTPException(status_code=404, detail="Bookmark not found")
    return row


@app.delete("/api/v1/learning/bookmarks/{bookmark_id}")
async def remove_bookmark(bookmark_id: str, course_id: str, store=Depends(ready_store)):
    if not await store.delete_bookmark(bookmark_id, course_id): raise HTTPException(status_code=404, detail="Bookmark not found")
    return {"deleted": True}


@app.get("/api/v1/courses/{course_id}/resources/{source_id}/location")
async def source_location(course_id: str, source_id: str, source_type: Literal["pdf", "ppt"], page: int = 1, slide: int = 1, store=Depends(ready_store)):
    location = page if source_type == "pdf" else slide
    rows = await store.get_location_chunks(course_id, source_id, source_type, location)
    if not rows: raise HTTPException(status_code=404, detail="No extracted content exists at that page or slide.")
    return {"source_type": source_type, "location": location, "resource_name": rows[0]["resource_name"], "passages": rows}


@app.get("/api/v1/learning/revision-notes")
async def list_revision_notes(course_id: str, store=Depends(ready_store)):
    return {"notes": (await store.get_feature_data(course_id))["notes"]}


@app.post("/api/v1/learning/revision-notes/generate")
async def generate_revision_notes(payload: SessionInput, store=Depends(ready_store)):
    data = await store.get_feature_data(payload.course_id)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for bookmark in data["bookmarks"]:
        for topic in bookmark.get("concept_tags") or [topic_for(bookmark.get("saved_explanation") or bookmark.get("note") or bookmark.get("resource_name", "Course review"))]:
            groups[topic].append(bookmark)
    if not groups: raise HTTPException(status_code=409, detail="Save a bookmark or explanation before generating revision notes.")
    saved = []
    for topic, bookmarks in groups.items():
        source_map = {f"S{i}": row for i, row in enumerate(bookmarks, 1)}
        source_text = "\n".join(f"[{label}] {row.get('saved_explanation') or row.get('note') or row.get('resource_name')}: {row.get('location')}" for label, row in source_map.items())
        prompt = NOTE_USER_PROMPT_TEMPLATE.format(topic=topic, sources=source_text, schema=json.dumps(NOTE_JSON_SCHEMA))
        try:
            output = parse_json_object(await state.llm.generate(NOTE_SYSTEM_PROMPT, prompt, max_tokens=800, allow_fallback=False)) or {}
        except Exception:
            output = {}
        allowed = [source_map[label] for label in output.get("source_labels", []) if label in source_map] if isinstance(output.get("source_labels"), list) else []
        refs = [{"source_id": row.get("source_id"), "source_type": row.get("source_type"), "resource_name": row.get("resource_name"), "location": row.get("location"), "quote": row.get("saved_explanation") or row.get("note", "")} for row in allowed or bookmarks]
        summary = str(output.get("summary") or bookmarks[0].get("saved_explanation") or bookmarks[0].get("note") or f"Review {topic} from your saved course locations.")[:2000]
        points = output.get("key_points") if isinstance(output.get("key_points"), list) else []
        saved.append(await store.save_revision_note({"course_id": payload.course_id, "topic": topic, "summary": summary, "key_points": [str(item)[:400] for item in points[:12]], "source_refs": refs}))
    return {"notes": saved}


@app.patch("/api/v1/learning/revision-notes/{note_id}")
async def edit_revision_note(note_id: str, payload: RevisionNoteInput, store=Depends(ready_store)):
    existing = next((row for row in (await store.get_feature_data(payload.course_id))["notes"] if row.get("id") == note_id), None)
    if not existing: raise HTTPException(status_code=404, detail="Revision note not found")
    return await store.save_revision_note({**existing, **payload.model_dump(), "id": note_id})


@app.delete("/api/v1/learning/revision-notes/{note_id}")
async def remove_revision_note(note_id: str, course_id: str, store=Depends(ready_store)):
    if not await store.delete_revision_note(note_id, course_id): raise HTTPException(status_code=404, detail="Revision note not found")
    return {"deleted": True}


@app.get("/api/v1/learning/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, store=Depends(ready_store)):
    return {"messages": await store.get_messages(session_id, 100)}


@app.post("/api/v1/interviews/profile/parse")
async def parse_candidate_profile(resume: UploadFile | None = File(default=None), job_description: UploadFile | None = File(default=None)):
    from .interview import extract_skills

    if resume is None and job_description is None:
        raise HTTPException(status_code=400, detail="Upload a resume or job description")
    parsed: dict[str, str] = {}
    for key, upload in (("resume_text", resume), ("job_description_text", job_description)):
        if upload is None:
            continue
        name = Path(upload.filename or "upload").name
        raw = await upload.read(settings.max_upload_mb * 1024 * 1024 + 1)
        check_upload_size(raw)
        try:
            _, rows = await run_in_threadpool(parse_document, name, raw)
            parsed[key] = "\n".join(str(row.get("text", "")) for row in rows)[:16000]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not extract {name}; use PDF, PPTX, TXT or Markdown.") from exc
    combined = f"{parsed.get('resume_text', '')}\n{parsed.get('job_description_text', '')}"
    return {**parsed, "detected_skills": extract_skills(combined)}


@app.get("/api/v1/interviews/cost")
async def interview_cost(minutes: int = 10):
    if minutes not in {10, 20, 30}:
        raise HTTPException(status_code=400, detail="Choose an interview length of 10, 20, or 30 minutes")
    return estimate_cost(minutes, settings.llm_provider, settings.llm_model)


@app.post("/api/v1/interviews", status_code=201)
async def start_interview(payload: InterviewInput, store=Depends(ready_store)):
    if payload.duration_minutes not in {10, 20, 30}:
        raise HTTPException(status_code=400, detail="Choose an interview length of 10, 20, or 30 minutes")
    course_context = ""
    if payload.course_id:
        course = await store.get_course(payload.course_id)
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        chunks, _ = await state.retriever.retrieve(payload.course_id, f"{payload.role} {payload.skill_level}", 86400)
        course_context = " ".join(chunk["content"] for chunk in chunks[:3])
    interview = make_interview(
        payload.role, payload.skill_level, payload.interview_type, payload.duration_minutes,
        payload.resume_text, payload.job_description, course_context,
    )
    interview.response_language = payload.response_language
    try:
        question = await next_question(interview, state.llm)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The configured language model is unavailable.") from exc
    interview.turns.append({"role": "interviewer", "content": question})
    await store.save_interview(interview)
    return {"interview_id": interview.id, "question": question, "candidate_skills": interview.candidate_skills,
            "cost_estimate": estimate_cost(payload.duration_minutes, settings.llm_provider, settings.llm_model)}


@app.get("/api/v1/interviews/{interview_id}")
async def get_interview(interview_id: str, store=Depends(ready_store)):
    interview = await store.get_interview(interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return interview.to_dict()


@app.post("/api/v1/interviews/{interview_id}/turn")
async def interview_turn(interview_id: str, payload: InterviewTurnInput, store=Depends(ready_store)):
    interview = await store.get_interview(interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    if interview.completed:
        raise HTTPException(status_code=409, detail="This interview is already complete")
    if payload.response_language is not None:
        interview.response_language = payload.response_language
    interview.turns.append({"role": "candidate", "content": payload.answer})
    await store.save_interview(interview)
    max_answers = interview.duration_minutes // 2
    if len([turn for turn in interview.turns if turn["role"] == "candidate"]) >= max_answers:
        await store.save_interview(interview)
        return {"interview_id": interview.id, "finished": True, "scorecard": scorecard(interview)}
    try:
        question = await next_question(interview, state.llm)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The configured language model is unavailable.") from exc
    interview.turns.append({"role": "interviewer", "content": question})
    await store.save_interview(interview)
    return {"interview_id": interview.id, "finished": False, "question": question,
            "turns": interview.turns, "cost_estimate": estimate_cost(interview.duration_minutes, settings.llm_provider, settings.llm_model)}


@app.post("/api/v1/interviews/{interview_id}/complete")
async def complete_interview(interview_id: str, store=Depends(ready_store)):
    interview = await store.get_interview(interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    interview.completed = True
    interview.scorecard = scorecard(interview)
    await store.save_interview(interview)
    return {"interview_id": interview.id, "scorecard": interview.scorecard,
            "cost_estimate": estimate_cost(interview.duration_minutes, settings.llm_provider, settings.llm_model)}


@app.get("/api/v1/openapi.json", include_in_schema=False)
async def versioned_openapi():
    return JSONResponse(app.openapi())


app.include_router(study_router(ready_store, state, settings, ensure_watched_notes))

from .intelligence import intelligence_router
app.include_router(intelligence_router(ready_store,state,settings,ensure_watched_notes))

from .companion import companion_router
app.include_router(companion_router(ready_store, state, ask, AskInput))
