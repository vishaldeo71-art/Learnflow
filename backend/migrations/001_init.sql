-- Apply once to a Supabase PostgreSQL project (SQL Editor or `supabase db push`).
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  description text not null default '',
  video_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  source_type text not null check (source_type in ('video','pdf','ppt','notes')),
  created_at timestamptz not null default now(),
  unique(course_id, name)
);

create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  source_type text not null check (source_type in ('video','pdf','ppt','notes')),
  resource_name text not null,
  content text not null,
  embedding extensions.vector(1024) not null,
  start_time integer,
  end_time integer,
  page_number integer,
  slide_number integer,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored,
  created_at timestamptz not null default now(),
  check (source_type <> 'video' or (start_time is not null and end_time is not null and end_time >= start_time)),
  check (source_type <> 'pdf' or page_number > 0),
  check (source_type <> 'ppt' or slide_number > 0)
);

create index if not exists chunks_course_source_time_idx on public.chunks(course_id, source_type, end_time);
create index if not exists chunks_search_vector_idx on public.chunks using gin(search_vector);
create index if not exists chunks_embedding_idx on public.chunks using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_time_idx on public.chat_messages(session_id, created_at);

create table if not exists public.interview_sessions (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  payload jsonb not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hybrid retrieval. The eligibility predicate is evaluated before either ranked candidate set,
-- so a future transcript chunk can never enter the returned context rows.
create or replace function public.search_course_chunks(
  p_course_id uuid,
  p_query_embedding extensions.vector(1024),
  p_query text,
  p_current_time integer,
  p_match_count integer default 12
)
returns table (
  id uuid, content text, source_type text, resource_name text,
  start_time integer, end_time integer, page_number integer, slide_number integer, score real
)
language sql stable security invoker set search_path = public, extensions
as $$
  with eligible as materialized (
    select c.*, (c.embedding <=> p_query_embedding) as distance
    from public.chunks c
    where c.course_id = p_course_id
      and (c.source_type <> 'video' or c.end_time <= p_current_time)
      and (
        c.embedding <=> p_query_embedding < 0.72
        or c.search_vector @@ plainto_tsquery('english', p_query)
      )
  ),
  vector_ranked as (
    select e.id, row_number() over (order by e.distance asc) as rank
    from eligible e
    order by e.distance asc limit greatest(p_match_count * 4, 24)
  ),
  keyword_ranked as (
    select e.id, row_number() over (order by ts_rank_cd(c.search_vector, plainto_tsquery('english', p_query)) desc) as rank
    from eligible e join public.chunks c on c.id = e.id
    where c.search_vector @@ plainto_tsquery('english', p_query)
    order by ts_rank_cd(c.search_vector, plainto_tsquery('english', p_query)) desc
    limit greatest(p_match_count * 4, 24)
  ),
  fused as (
    select e.id,
      coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + k.rank), 0) as rrf_score
    from eligible e
    left join vector_ranked v on v.id = e.id
    left join keyword_ranked k on k.id = e.id
  )
  select c.id, c.content, c.source_type, c.resource_name, c.start_time, c.end_time,
         c.page_number, c.slide_number, f.rrf_score::real as score
  from fused f join public.chunks c on c.id = f.id
  order by f.rrf_score desc
  limit least(greatest(p_match_count, 1), 40)
$$;

-- The future detector returns metadata only; it never returns the future transcript text.
create or replace function public.find_future_video_match(
  p_course_id uuid,
  p_query_embedding extensions.vector(1024),
  p_query text,
  p_current_time integer
)
returns table (resource_name text, start_time integer, score real)
language sql stable security invoker set search_path = public, extensions
as $$
  select c.resource_name, c.start_time,
         greatest(1 - (c.embedding <=> p_query_embedding),
           case when c.search_vector @@ plainto_tsquery('english', p_query) then 0.5 else 0 end)::real as score
  from public.chunks c
  where c.course_id = p_course_id and c.source_type = 'video' and c.end_time > p_current_time
    and (c.embedding <=> p_query_embedding < 0.72 or c.search_vector @@ plainto_tsquery('english', p_query))
  order by score desc, c.start_time asc
  limit 1
$$;

-- Data API users should be scoped by Supabase Auth. The backend connects with a server-side
-- database/service credential; never expose that credential to the browser.
alter table public.courses enable row level security;
alter table public.resources enable row level security;
alter table public.chunks enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.interview_sessions enable row level security;

drop policy if exists courses_owner_access on public.courses;
create policy courses_owner_access on public.courses for all to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists resources_course_owner_access on public.resources;
create policy resources_course_owner_access on public.resources for all to authenticated
  using (exists (select 1 from public.courses c where c.id=course_id and c.created_by=auth.uid()))
  with check (exists (select 1 from public.courses c where c.id=course_id and c.created_by=auth.uid()));
drop policy if exists chunks_course_owner_access on public.chunks;
create policy chunks_course_owner_access on public.chunks for all to authenticated
  using (exists (select 1 from public.courses c where c.id=course_id and c.created_by=auth.uid()))
  with check (exists (select 1 from public.courses c where c.id=course_id and c.created_by=auth.uid()));
drop policy if exists sessions_owner_access on public.learning_sessions;
create policy sessions_owner_access on public.learning_sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists messages_owner_access on public.chat_messages;
create policy messages_owner_access on public.chat_messages for all to authenticated
  using (exists (select 1 from public.learning_sessions s where s.id=session_id and s.user_id=auth.uid()))
  with check (exists (select 1 from public.learning_sessions s where s.id=session_id and s.user_id=auth.uid()));
drop policy if exists interview_owner_access on public.interview_sessions;
create policy interview_owner_access on public.interview_sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
