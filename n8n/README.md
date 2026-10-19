# Optional n8n ingestion bridge

Import a minimal webhook/HTTP workflow if your team already uses n8n:

1. Start from the repo's Supabase/Notion upsert pattern linked from `../docs/N8N_WORKFLOWS.md`.
2. Replace the vector-store and LLM-answer branches with an authenticated HTTP Request to `POST {{$env.LEARNFLOW_API_URL}}/api/v1/courses/{{$json.course_id}}/resources`.
3. Send a multipart field named `file` containing the actual PDF, PPTX, VTT/SRT or notes. Store the bearer in an n8n credential, not in workflow JSON.
4. Trigger on new/changed file metadata only. Use a deterministic `course_id` and filename; FastAPI replaces old chunks when that resource name is re-ingested.
5. Log only resource ID, ingest status, chunk count and request ID. Keep learner query/chat outside n8n.

The app does not require n8n. Local upload and `/api/v1/courses/{id}/resources` already cover manual ingestion.

