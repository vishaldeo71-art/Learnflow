alter table public.topic_progress add column last_practiced_at timestamptz;
update public.topic_progress set last_practiced_at=last_reviewed_at,last_reviewed_at=case when correct_streak>0 then last_reviewed_at else null end;
