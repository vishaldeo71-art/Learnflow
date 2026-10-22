# API guide

Interactive OpenAPI docs: `/docs`; generated schema: `/openapi.json` (also `/api/v1/openapi.json`). Send `Authorization: Bearer $APP_API_KEY` when API key enforcement is enabled.

## Ask at a video position

```http
POST /api/v1/learning/ask
Content-Type: application/json

{
  "course_id": "<course UUID>",
  "session_id": "<optional learning session UUID>",
  "question": "What does hybrid retrieval combine?",
  "video_time_seconds": 780,
  "action": "answer"
}
```

Response: `session_id`, grounded `answer`, `citations[]`, retrieved chunk count, timestamp, `confidence`, `knowledge_scope`, and optional `refusal_reason` / `general_knowledge_available`. Citation objects include source id/type, chunk id, video time range or PDF page/PPT slide, resource name, and a short evidence quote. Send `general_knowledge: true` only after the learner opts in; those answers are labeled `Not from your material` and have no course citations.

Valid actions: `answer`, `simplify`, `example`, `where`, `summary`, `quiz`, `compare`. Summary/quiz get a bounded, timestamp-gated context. Follow-ups use recent messages in the same session.

## Ingest course resource

```bash
curl -X POST "http://localhost:8000/api/v1/courses/$COURSE_ID/resources" \
  -H "Authorization: Bearer $APP_API_KEY" \
  -F "file=@lesson.vtt"
```

Supported extensions: `.pdf`, `.pptx`, `.vtt`, `.srt`, timestamped `.json`, `.txt`, `.md`, `.markdown`. Re-uploading the same filename in one course replaces its chunks.

## Interview

`POST /api/v1/interviews` accepts JSON fields `role`, `skill_level`, `interview_type`, `duration_minutes` (10/20/30), `resume_text`, `job_description`, and optional `course_id`. It returns an `interview_id`, the first question, skills detected, and cost estimate. Submit answers to `/api/v1/interviews/{id}/turn`; call `/complete` for the scorecard. Upload PDF/TXT resume and JD files to `/api/v1/interviews/profile/parse` to extract text and detect skills.

## Operational errors

Errors use FastAPI status codes and a concise `detail`. Unexpected errors are logged with a request ID and return a generic message. Common responses: `400` unsupported/invalid file; `401` bad configured bearer token; `404` unknown course/session/interview; `413` upload exceeds `MAX_UPLOAD_MB`; `429` rate limit; `503` startup or model provider unavailable.

## Quizzes, bookmarks and revision

- `POST /api/v1/learning/quiz` JSON `{ "course_id": "...", "video_time_seconds": 120, "topic": null }`; returns five public questions and a quiz id. Video source chunks are restricted to `end_time <= video_time_seconds`.
- `POST /api/v1/learning/quiz/{quiz_id}/answer` JSON `{ "course_id": "...", "question_id": "...", "selected_index": 1 }`; correctness is checked server-side. Wrong answers include an explanation and source citation; adaptive follow-ups stay on that topic.
- `GET /api/v1/learning/progress?course_id=...` returns weak topics.
- `GET /api/v1/learning/revision-queue?course_id=...` returns queue items and formula weights. `POST /api/v1/learning/revision-queue/revised` accepts `{ "course_id": "...", "topic": "..." }`.
- `GET|POST /api/v1/learning/bookmarks?course_id=...`; `POST` requires `course_id`, `source_id`, `source_type` (`video|pdf|ppt`), `resource_name`, and `location` (`seconds`, `page`, or `slide`). `PATCH|DELETE /api/v1/learning/bookmarks/{bookmark_id}` edits or removes a saved item.
- `GET /api/v1/courses/{course_id}/resources/{source_id}/location?source_type=pdf&page=14` (or `source_type=ppt&slide=7`) returns extracted passages for the in-place viewer.
- `GET /api/v1/learning/revision-notes?course_id=...`; `POST /api/v1/learning/revision-notes/generate` accepts `{ "course_id": "..." }`; `PATCH|DELETE /api/v1/learning/revision-notes/{note_id}` manages notes.

Apply `backend/migrations/003_learning_features.sql` after migrations 001 and 002 for durable data. `docs/LEARNING_FEATURES.md` contains the architecture, exact model prompts/schemas, and demo script.


## Automatic YouTube captions

`POST /api/v1/videos/youtube/import` with JSON `{"url":"https://www.youtube.com/watch?v=mx3J9wdbJ30"}`.

Returns `course` (including `video_url`), `status: "ready"`, `cached`, and on first import `language`, `generated`, and `chunk_count`. Existing imported courses are reused. Only recognized YouTube video URLs are accepted; arbitrary URL fetching is not supported. Captions are fetched with timeouts and size bounds, then embedded and stored as video passages. Errors: 400 invalid URL, 422 unavailable/blocked captions, 504 import timeout. No captions or wrong-source fallback are fabricated on failure.

Apply migration `002_course_video.sql` to existing databases. The Next.js proxy allows a 120-second execution budget; backend import has a 100-second timeout. Hosting must support these request durations. Long lessons or slow hosted embeddings may exceed the timeout; a background job queue is recommended for large-scale ingestion.
