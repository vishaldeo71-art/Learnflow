-- Existing deployments: apply after 001_init.sql before restarting the API.
alter table public.courses add column if not exists video_url text;
create index if not exists courses_video_url_idx on public.courses(video_url) where video_url is not null;
