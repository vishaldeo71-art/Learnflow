## Current Vercel Services deployment

Import `vishaldeo71-art/Learnflow` with the repository root selected. Root `vercel.json` builds `frontend` and `backend` together. Only the frontend has a public rewrite; its server proxy uses the generated `BACKEND_API_URL` binding to call the private backend. Do not manually set that binding variable on Vercel.

Set server-only production environment variables: `APP_ENV=production`, `DATABASE_URL` (Supabase transaction pooler with TLS), `APP_API_KEY` and matching `BACKEND_API_KEY`, `LLM_PROVIDER=gemini`, `LLM_MODEL`, `GEMINI_API_KEY`, `EMBEDDING_PROVIDER=local`, `EMBEDDING_DIMENSIONS=1024`, and `MAX_UPLOAD_MB=4`. Credentials must remain outside Git.

The database uses a dedicated `learnflow_app` login limited to this application's six tables and retrieval functions. RLS grants backend access to that role; anonymous Data API access is not granted. The transaction pooler requires asyncpg prepared-statement caching to be disabled. Local embeddings are supported in production and do not require a separate paid embedding API.

The database was provisioned separately in Supabase and persists through Vercel deployments. The current UI is a shared demo without per-user sign-in. Do not use private user documents until application authentication and ownership checks are added.

# Deployment guide

## Vercel + Render + Supabase

### 1. Supabase

1. Create a project; save its PostgreSQL connection string in a password manager.
2. In SQL Editor, run `backend/migrations/001_init.sql`.
3. Copy the server-side PostgreSQL connection string (SSL enabled) for Render. Do not place a Supabase service key, database password or connection string in frontend variables.
4. Add a long random shared API token for this hackathon deployment. Authentication is global until an LMS/Supabase JWT integration is added.

### 2. Render API

1. Push this folder to a Git repository you control.
2. In Render, create a Blueprint from `render.yaml` (root directory is `backend`).
3. Configure secret environment values:
   - `DATABASE_URL`: Supabase PostgreSQL connection string.
   - `APP_API_KEY`: long random bearer secret.
   - `LLM_PROVIDER`: `gemini`, `openai`, or `bedrock`.
   - Corresponding model API key or AWS IAM role/region.
   - `EMBEDDING_PROVIDER`: `gemini`, `openai`, `bedrock`, or `local`.
   - Optional `LLM_MODEL` and `EMBEDDING_MODEL` overrides. The checked local Gemini configuration uses `gemini-3.5-flash-lite`; Bedrock uses Claude Haiku 4.5 + Titan Text Embeddings V2.
4. Deploy and verify `https://<render-service>/health`, then `/docs`.

Check current model access, endpoints and regional availability in the [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models), [Gemini embedding guide](https://ai.google.dev/gemini-api/docs/embeddings), and [Amazon Bedrock model catalog](https://docs.aws.amazon.com/bedrock/latest/userguide/models.html). Provider quotas, model IDs and prices vary by account and region.

### 3. Vercel frontend

1. Import the same repository and select `frontend` as the project root.
2. Add server-only environment variables:
   - `BACKEND_API_URL=https://<render-service>`
   - `BACKEND_API_KEY` matching the Render `APP_API_KEY`.
   - Optional `NEXT_PUBLIC_DEMO_VIDEO_URL` for a browser-accessible MP4/HLS URL.
3. Deploy. Add the Vercel origin to Render `CORS_ORIGINS` if calling the API directly; the included Next route proxy normally avoids browser cross-origin calls.
4. Test course loading, a past-content answer, a future-only refusal, an uploaded PDF/PPT, a 10-minute mock interview, and a citation seek. Use `/health` and hosted OpenAPI docs for API diagnosis.

Vercel variables are available to the server route at runtime; never prefix the backend bearer secret with `NEXT_PUBLIC_`. Set `APP_API_KEY` and `BACKEND_API_KEY` as the same value.

### 4. Before the demo

- Use one sample educational video with a transcript whose timestamps match it; the included transcript is illustrative and does not match a bundled video.
- Upload its PDF/PPT/notes to the course and inspect citation labels/pages.
- Re-ingest resources only after finalizing the embedding provider/model.
- Set a request limit at the edge. The FastAPI local limiter is not shared across instances.
- Check the selected LLM and embedding provider's current pricing, quota and regional availability.

## AWS alternative

Recommended shape: CloudFront → Next.js Node container on ECS Fargate (server-side rendering and API proxy) plus FastAPI on ECS behind an HTTPS ALB/API Gateway → RDS PostgreSQL with pgvector → Bedrock model/embeddings. This app needs a Next.js server runtime; a static S3 export alone is not enough. Store uploaded originals in private S3, use SQS for large ingestion batches and Lambda/ECS workers to parse/embed, CloudWatch for logs/metrics, Secrets Manager for credentials, Cognito or the LMS for learner identity, and WAF for edge controls.

Deployment steps:

1. Create a VPC with private subnets for ECS and RDS; permit inbound database connections only from the API task security group.
2. Create an RDS PostgreSQL database, enable/install pgvector, and apply `backend/migrations/001_init.sql` (Supabase Auth/RLS statements should be replaced with Cognito/LMS identity policies for a pure AWS deployment).
3. Build and push the backend Docker image to ECR. Create an ECS Fargate service behind an HTTPS ALB or API Gateway integration; set health path `/health`.
4. Store `DATABASE_URL` and any provider secrets in Secrets Manager. Set task variables `LLM_PROVIDER=bedrock`, `EMBEDDING_PROVIDER=bedrock`, `AWS_REGION`, and `BEDROCK_MODEL_ID`. Attach least-privilege IAM permissions for the chosen Bedrock model and S3/SQS resources.
5. Build the frontend image from `frontend/` and run it as a Node container in ECS behind CloudFront/ALB. Set `BACKEND_API_URL` and `BACKEND_API_KEY` as server-side task environment/secrets for the proxy.
6. Configure autoscaling on ECS request/CPU signals, ALB/API Gateway throttling, WAF, log retention, alarms and backups. Verify exact RDS/Bedrock support and pricing in the target AWS region before creation.

`infra/aws/task-definition.example.json` shows the task shape and intentionally contains no account IDs or secrets. This repo does not provision cloud accounts or incur cloud resources; deploy steps require your AWS account and approved spend.

### Automatic caption import

Install the updated backend requirements and apply `backend/migrations/002_course_video.sql` to existing Supabase databases before restarting the API. New setups should apply both migrations in order. Allow at least 120 seconds for the frontend proxy route; the backend import is bounded at 100 seconds. YouTube may deny caption requests from cloud-server IPs, so verify with a captioned video from the deployed environment. A model API key does not unlock unavailable or blocked YouTube captions. The app reports these failures and never falls back to another lesson's resources.
