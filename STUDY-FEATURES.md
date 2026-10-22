# Accounts and study tools

Learnflow uses Supabase Auth for email/password sign-in, confirmation, and password recovery. Next.js refreshes HTTP-only session cookies and forwards a verified access token through the private backend proxy. The backend checks that token with Supabase Auth and scopes private courses, conversations, interviews, and study records to its owner. Shared legacy lessons remain readable examples; create a private course before adding personal supporting materials.

## Authentication setup

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on both Vercel services. Keep `BACKEND_API_KEY` and `APP_API_KEY` server-only. Apply the migrations in `supabase/migrations` to the existing database.

In Supabase Authentication → URL Configuration, set the site URL to `https://learnflow-theta.vercel.app` and allow the exact `/auth/callback` and `/auth/confirm` URLs (plus localhost equivalents only for development). Keep email verification enabled. Configure custom SMTP before opening registration and password recovery to the public; Supabase's default sender only delivers to organization members. Confirm signup and recovery emails on the deployed site before considering mail delivery ready.

The sign-in page includes account creation, a secure password generator, and Forgot password. A one-time private admin setup code promotes only the authenticated account claiming it. Administrator roles are stored in `learner_profiles`, never in editable user metadata. No email address is assigned administrator status in the code. Setup codes are hashed, expiring, and consumed atomically; they are not committed to this repository. The account security page allows the signed-in account to generate and save a new password.

## Adaptive quizzes

A quiz uses only transcript passages ending at or before the selected playhead, plus supporting documents. Gemini produces structured multiple-choice questions with exact source identifiers. The server rejects unknown evidence and duplicate choices, and retains the answer key privately until an answer is submitted. Grading locks the quiz row; retries cannot create duplicate mistakes. Incorrect answers lower difficulty and create a weak-topic record; two consecutive correct answers can raise difficulty. New quizzes prioritize an existing weak topic, and the feedback panel offers a focused follow-up.

## Bookmarks, notes, and revision

Save a confusing timestamp with a personal note, or bookmark a guide explanation. Save explanations explicitly or enable automatic concept notes. Answered quiz concepts also produce revision notes when automatic saving is enabled. Each saved record retains its supporting evidence. Notes can be exported as Markdown.

The revision queue ranks weak topics and bookmarks using mistake count and time since practice or review. A new mistake becomes due immediately. A successful practice answer or manual review starts a one-day cooldown; three correct answers in a row clear a weak topic. Marking an item reviewed never fabricates a correct quiz result.

## Evidence

Grounded answers return a structured support decision and cited source labels. Unsupported questions show no claimed citations and offer a separate, explicit opt-in to a general explanation. General explanations carry a visible label and cannot become evidence-backed notes. Evidence details show source excerpts, timestamp links, PDF pages or slide numbers. AI video notes remain labeled approximate.

New uploads retain the original file privately (20 MB application limit), so evidence can open the original document or PDF page. Older uploads only have extracted passages; their evidence panel explains when the original file is unavailable. Private source files require authentication and course access on every request.

## Admin overview

`/admin` requires a current database administrator role on the server and the backend. It reports actual account, course, quiz, bookmark, note, interview, answer, and mistake counts; recent learner activity; and aggregate weak topics. Ordinary learners receive HTTP 403 from the admin API. It does not expose learner passwords or private chat bodies.

## Verification

Run the backend unittest suite from `backend` and `npm test`, `npm run typecheck`, and `npm run build` from `frontend`. Tests cover learner isolation, private shared-example writes, evidence gating, hidden answer keys, idempotent grading, revision ranking, broader-answer consent, and all 66 interface catalogs. Live verification additionally exercises Supabase sign-in, a retained source upload, Gemini answers and quizzes, saved study records, a single-use admin setup code, and administrator access checks.

## Intelligence upgrade

`POST /api/v1/intelligence/generate` adds Formula Decoder, Precision Recall, Confusion Twins, Memory Hooks, One-Shot Memory Sheet, and Smart Checkpoint. It reuses the existing provider, source metadata, course ownership checks, and private study tables. No additional dependency or migration is needed for these intelligence tools.

Generation validates structured output and copied source quotations before saving it. Formula text must match the original material. Illustrative assumed inputs and creative memory aids are visibly separated from lecture facts. Short-answer recall keeps its reference answer private, accepts source-listed synonyms and minor spelling differences, and preserves exact numbers and mathematical signs. `POST /api/v1/intelligence/recall/{quiz_id}/answers` grades an answer and records practice; `POST /api/v1/intelligence/recall/{quiz_id}/retry` creates a fresh retry. Incorrect or overdue topics reuse the existing revision queue.

One-shot checkpoints count advancing player time while the player reports that it is playing. Forward or backward seeks, paused time, and wall-clock time do not count. Offers are optional and never pause playback. A checkpoint can also be generated manually for a short demonstration. Memory sheets reflect at most twelve sampled available passages, not a claim to cover an entire lecture.

Diagram Explainer is deferred because document ingestion currently extracts text without supplying diagram pixels. Verified Exam Facts is deferred because no authoritative external-retrieval pipeline is connected; general Gemini output is never labeled independently verified. Exact recall matching currently handles aliases found in the source and small spelling errors, rather than arbitrary semantic paraphrases.

Upstream learning endpoints are retained. The authenticated compatibility adapter stores their learner records privately in the new study tables, so older quiz and revision clients remain usable without exposing another learner's records.
