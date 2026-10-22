-- Auth identities are verified by the private backend. No browser role can edit roles or answer keys.
create table public.learner_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null, display_name text not null default '',
 role text not null default 'learner' check(role in ('learner','admin')),
 auto_notes boolean not null default true,
 created_at timestamptz not null default now(), last_active_at timestamptz not null default now()
);
create table public.admin_bootstrap (
 code_hash text primary key, expires_at timestamptz not null,
 used_by uuid references auth.users(id), used_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.study_notes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade,
 payload jsonb not null, origin text, created_at timestamptz not null default now(),
 last_reviewed_at timestamptz, unique(user_id,origin)
);
create table public.study_bookmarks (like public.study_notes including all);
alter table public.study_bookmarks add foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.study_bookmarks add foreign key (course_id) references public.courses(id) on delete cascade;
create table public.practice_quizzes (like public.study_notes including all);
alter table public.practice_quizzes add foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.practice_quizzes add foreign key (course_id) references public.courses(id) on delete cascade;
create table public.topic_progress (
 user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade,
 topic_key text not null, title text not null, source_ids jsonb not null default '[]',
 attempts integer not null default 0 check(attempts>=0), incorrect integer not null default 0 check(incorrect>=0),
 correct_streak integer not null default 0, difficulty integer not null default 1 check(difficulty between 1 and 3),
 created_at timestamptz not null default now(), last_reviewed_at timestamptz,
 primary key(user_id,topic_key)
);
create table public.resource_files (
 resource_id uuid primary key references public.resources(id) on delete cascade,
 filename text not null, content_type text not null, content bytea not null,
 check(octet_length(content)<=20971520)
);
create index study_notes_user_course on public.study_notes(user_id,course_id,created_at desc);
create index study_bookmarks_user_course on public.study_bookmarks(user_id,course_id,created_at desc);
create index practice_quizzes_user_course on public.practice_quizzes(user_id,course_id,created_at desc);
create index topic_progress_user_course on public.topic_progress(user_id,course_id);
create index courses_created_by on public.courses(created_by);
create index learning_sessions_user_id on public.learning_sessions(user_id);
create index interview_sessions_user_id on public.interview_sessions(user_id);
do $$ declare t text; begin
 foreach t in array array['learner_profiles','admin_bootstrap','study_notes','study_bookmarks','practice_quizzes','topic_progress','resource_files'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to learnflow_app',t);
  execute format('create policy backend_access on public.%I to learnflow_app using(true) with check(true)',t);
 end loop;
end $$;
-- Existing authenticated policies remain defensive, but all application data goes through the private, ownership-scoped backend.
