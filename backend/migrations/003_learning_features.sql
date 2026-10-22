-- Persistent learner study features: saved locations, adaptive quiz history and notes.
create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  source_id uuid not null references public.resources(id) on delete cascade,
  source_type text not null check (source_type in ('video','pdf','ppt')),
  resource_name text not null,
  location jsonb not null,
  note text not null default '',
  saved_explanation text not null default '',
  concept_tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists bookmarks_course_created_idx on public.bookmarks(course_id, created_at desc);

create table if not exists public.quiz_sets (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  video_time_seconds integer not null default 0 check (video_time_seconds >= 0),
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quiz_sets_course_created_idx on public.quiz_sets(course_id, created_at desc);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  quiz_id uuid not null references public.quiz_sets(id) on delete cascade,
  question_id text not null,
  topic text not null,
  correct boolean not null,
  difficulty smallint not null check (difficulty between 1 and 3),
  selected_index smallint not null check (selected_index between 0 and 3),
  citation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quiz_attempts_course_topic_idx on public.quiz_attempts(course_id, topic, created_at desc);

create table if not exists public.topic_reviews (
  course_id uuid not null references public.courses(id) on delete cascade,
  topic text not null,
  last_reviewed timestamptz not null default now(),
  primary key(course_id, topic)
);

create table if not exists public.revision_notes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  topic text not null,
  summary text not null,
  key_points jsonb not null default '[]'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists revision_notes_course_topic_idx on public.revision_notes(course_id, topic);
