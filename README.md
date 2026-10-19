> Hosted configuration: the repository root deploys the Next.js frontend and FastAPI backend together through Vercel Services (beta). The backend is private and reached through a server-side service binding. Courses, resources, chats, and interviews persist in the separate Learnflow Supabase project.
>
> This is a shared demo workspace; individual user accounts are not implemented. Use sample material rather than private personal documents. Vercel request limits restrict uploads to 4 MB in this deployment. YouTube caption availability depends on the upstream service.
>
> Deployment secrets are managed in Vercel environment settings and are excluded from this repository.

# Learnflow: AI Learning Assistant

Timestamp-aware course Q&A plus a personalized mock interview, built as a Next.js client and FastAPI API. The app can run locally in a no-key demo mode, then use PostgreSQL/Supabase and Gemini, OpenAI, or Amazon Bedrock when configured.

## What is included

- Video player with a learner-time control, chat, quick learning actions, and clickable timestamp/page/slide citations.
- PDF, PPTX, VTT, SRT, JSON transcript, Markdown and text ingestion. Transcript chunks retain start/end times; documents retain page or slide numbers.
- Hybrid retrieval in Supabase PostgreSQL using pgvector and full-text search, rank fusion, a small reranker, and a hard `end_time <= T` database predicate before prompt construction.
- Future-content detector that returns metadata only, and clear refusal for future-only or unsupported questions.
- Conversation history and actions: simplify, example, where discussed, summarize so far, quiz, compare and follow-up.
- Resume/JD text extraction, personalized follow-up interview turns, explainable practice scorecard and estimated cost for 10/20/30 minute sessions.
- Gemini, OpenAI, and Bedrock provider adapters; local feature-hash embeddings and a deterministic mock model for offline demos.
- Supabase migration, local/container configs, Vercel and Render deployment files, AWS alternative, API docs, architecture diagram, evaluation cases, results template, demo script and optional n8n ingestion notes.

## Run locally

### Easiest: Docker Compose

Install Docker Desktop, unzip the project, and open a terminal in the `Learnflow` folder. Copy `.env.example` to `.env` (`cp .env.example .env` on macOS/Linux or `Copy-Item .env.example .env` in Windows PowerShell), then run:

```bash
docker compose up --build
```

Open `http://localhost:3000`. The default setup uses the no-key demo responder and local storage. To enable Gemini, edit `.env`: set `LLM_PROVIDER=gemini` and add your own `GEMINI_API_KEY`; `LLM_MODEL=gemini-3.5-flash-lite` is prefilled. Restart with `docker compose down` followed by `docker compose up --build`. Never share your `.env` or API key.

To stop the app, press `Ctrl+C` in the terminal and run `docker compose down`.

### Run without Docker

Requirements: Python 3.11+ (3.12 recommended), Node.js 20.9+, and npm. The first run needs internet access to install packages. Copy the root `.env.example` to `.env`; leave `LLM_PROVIDER=mock`, `EMBEDDING_PROVIDER=local`, and `DATABASE_URL` blank for the local sample.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The sample lesson and notes are loaded into process memory when the API starts. Its timeline can be scrubbed without a video file. For playback, paste a YouTube watch/short link or direct MP4/WebM URL and click **Load video**. Playback time, the timeline, and citation seeking stay synchronized. The video must permit embedding. The local mode is intentionally disposable: memory, sessions and uploads reset when the API restarts.

If you set `APP_API_KEY` locally, also create `frontend/.env.local` with `BACKEND_API_URL=http://localhost:8000` and `BACKEND_API_KEY` set to the same value. The Next.js server-side proxy uses these values; do not prefix the secret with `NEXT_PUBLIC_`.

## Use your own lesson

1. Paste a YouTube link in **Lesson video URL** and click **Load video**.
2. The app retrieves available public captions, creates a separate course named after the video, and switches the chat to that course. Wait for **Transcript ready**.
3. Play the video or seek to a position, then ask a question. Only transcript chunks ending at or before that position can enter the answer.
4. Add PDF, PPTX, or notes under **Supporting materials** if needed.

Caption import needs no model API key. The **Demo responses** banner means answers quote the imported material with a deterministic responder; configure a model below for natural explanations. At 00:00, play the video before asking for a summary.

Public caption availability is controlled by YouTube. Disabled captions, private videos, or blocked server requests return a clear error and keep chat disconnected from unrelated courses. Automatic speech transcription of videos without captions is not included. Captions are grouped into passages of about 20 seconds, with fractional end times rounded up to preserve the playback boundary. Re-importing the same URL reuses its existing course. Imported courses survive restarts only with PostgreSQL configured.

The importer uses [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api); its maintainers document that YouTube may block requests from cloud providers. Check caption import on your actual deployment before the demo. Direct MP4/WebM playback still requires a matching transcript upload.

## Configure a model

Choose one provider in `.env`, add its server-side key/credentials, then restart FastAPI:

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=replace-with-your-key
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMENSIONS=1024
```

Other providers: `LLM_PROVIDER=openai` with `OPENAI_API_KEY`, or `LLM_PROVIDER=bedrock` with AWS credentials/role plus `AWS_REGION`. Embeddings can independently be `local`, `openai`, `gemini`, or `bedrock`. Keep the embedding dimension at 1024 to match the migration. The `mock` model is for local walkthroughs and is not a substitute for a hosted model.

The checked local Gemini configuration uses `gemini-3.5-flash-lite`. Bedrock uses Claude Haiku 4.5 with Titan Text Embeddings V2. Override `LLM_MODEL` or `EMBEDDING_MODEL` when a selected provider model or region requires it; re-embed the course after changing embedding models.

## Use Supabase storage

1. Create a Supabase project and run [`backend/migrations/001_init.sql`](backend/migrations/001_init.sql) and [`backend/migrations/002_course_video.sql`](backend/migrations/002_course_video.sql) in its SQL editor.
2. Set the project PostgreSQL connection string in `DATABASE_URL`. Use an SSL-enabled server-side connection string; never put it in a `NEXT_PUBLIC_*` variable.
3. Set `APP_API_KEY` to a long random secret. The Next.js server-side proxy forwards it from `BACKEND_API_KEY`; set both to the same value. Keep both out of browser-exposed variables.
4. Start the API. It will seed the sample course only when the database has no courses. Uploaded resource names replace their old chunks on re-ingest.

## Main API

FastAPI serves interactive docs at `http://localhost:8000/docs` and OpenAPI at `http://localhost:8000/openapi.json`.

- `GET /health`, `GET /api/v1/status`
- `GET /api/v1/courses`, `POST /api/v1/courses`
- `POST /api/v1/videos/youtube/import` (YouTube URL → separate course + timestamped captions)
- `POST /api/v1/courses/{course_id}/resources` (multipart file)
- `POST /api/v1/learning/sessions`, `POST /api/v1/learning/ask`
- `POST /api/v1/interviews/profile/parse`, `GET /api/v1/interviews/cost`
- `POST /api/v1/interviews`, `POST /api/v1/interviews/{id}/turn`, `POST /api/v1/interviews/{id}/complete`

Request examples and response schemas are in [`docs/API.md`](docs/API.md).

## Verify and evaluate

```bash
cd backend
python -m unittest discover -s tests -v
python scripts/evaluate.py
```

The evaluation runner writes `backend/data/evaluation/results_local.csv`. Use `results_template.csv` to record hosted-model latency, token counts, cost and human citation review. These sample tests validate core mechanisms; they do not replace cloud integration, load, security, or human quality evaluation.

## Deployment

Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the Vercel + Render + Supabase path and the AWS alternative. Do not call the app “hosted” until the services, secrets, model billing, domain/CORS settings, and public smoke test are complete.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DEMO.md`](docs/DEMO.md), and [`docs/EVALUATION.md`](docs/EVALUATION.md). Optional workflow patterns adapted from the supplied n8n template repo are documented in [`docs/N8N_WORKFLOWS.md`](docs/N8N_WORKFLOWS.md).

## Security and limits

API key enforcement is optional locally and should be enabled for a public deployment. The in-process rate limiter is best effort; use an edge/API gateway limit with multiple replicas. A shared API key is not per-learner identity: connect LMS/Supabase Auth JWTs and user-scoped authorization before storing real learner or candidate data. Uploads are size-limited and parsed in memory, not retained in Supabase Storage. Add object storage, malware scanning, retention controls, data deletion and privacy notices for a real cohort.

The scorecard is a transparent practice rubric, not a hiring recommendation. Cost figures use editable planning assumptions and must be updated against the chosen provider's current pricing. Extracted resume and job-description text is stored with the interview session and sent to the configured model provider to personalize questions. Before using real candidate data, define consent, access, retention, deletion, and provider data-handling controls.

### Transcript quality and watched context

Caption imports compare available tracks and reject collapsed repeated text. Original Hindi captions can be used directly with Gemini multilingual embeddings; English questions receive English answers. Summary and quiz actions sample useful passages across the watched portion and retain recent context. They never use a future-topic search. Specific questions use semantic similarity, with every video passage gated by its end timestamp.

Use the same embedding provider/model for document indexing and question retrieval. Switching from local feature hashing to Gemini requires rebuilding **all** stored chunk vectors before serving semantic queries; equal vector dimensions alone do not make different models compatible. Keep a recoverable data backup during that migration. Chat answers display the question's captured video position, independent of later playback movement.
