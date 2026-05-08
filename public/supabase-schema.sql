-- Run once in the Supabase SQL Editor.
-- RLS: anonymous users may INSERT only (for static GitHub Pages sites).

create table if not exists public.study_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text not null,
  condition_key text not null,
  submitted_at timestamptz not null,
  user_agent text,
  schema_version int not null default 1,
  demographics jsonb not null default '{}',
  pre_survey jsonb not null default '{}',
  attention2 jsonb not null default '{}',
  post_survey jsonb not null default '{}',
  memory_responses jsonb not null default '[]',
  event_log jsonb not null default '[]',
  filler_stats jsonb not null default '{}',
  group_id text,
  anon_id text,
  participant_id text
);

alter table public.study_submissions enable row level security;

create policy "anon_insert_study_submissions"
  on public.study_submissions
  for insert
  to anon
  with check (true);

-- Team dashboard (#/admin), no login: allow anon SELECT.
-- WARNING: the anon key ships in the browser bundle — anyone with your site URL can read all rows.
-- Do not use for identifiable or highly sensitive data unless the study URL is strictly private.
drop policy if exists "anon_select_study_submissions" on public.study_submissions;
create policy "anon_select_study_submissions"
  on public.study_submissions
  for select
  to anon
  using (true);

-- Separate table for group discussion logs (one row per question in a group session).
-- `discussion_log` stores the full per-question chat as a JSONB array.
create table if not exists public.discussion_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text not null,
  group_id text not null,
  anon_id text,
  participant_id text,
  question_index int not null,
  slide_id text not null,
  discussion_log jsonb not null default '[]'
);

create unique index if not exists discussion_messages_group_question_unique
  on public.discussion_messages (group_id, question_index, slide_id);

alter table public.discussion_messages enable row level security;

drop policy if exists "anon_insert_discussion_messages" on public.discussion_messages;
create policy "anon_insert_discussion_messages"
  on public.discussion_messages
  for insert
  to anon
  with check (true);

drop policy if exists "anon_update_discussion_messages" on public.discussion_messages;
create policy "anon_update_discussion_messages"
  on public.discussion_messages
  for update
  to anon
  using (true)
  with check (true);

-- Optional: allow dashboard/analysis reads directly from the browser.
drop policy if exists "anon_select_discussion_messages" on public.discussion_messages;
create policy "anon_select_discussion_messages"
  on public.discussion_messages
  for select
  to anon
  using (true);

create or replace function public.upsert_discussion_log_row(
  p_session_id text,
  p_group_id text,
  p_anon_id text,
  p_participant_id text,
  p_question_index int,
  p_slide_id text,
  p_discussion_log jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.discussion_messages (
    session_id,
    group_id,
    anon_id,
    participant_id,
    question_index,
    slide_id,
    discussion_log
  ) values (
    p_session_id,
    p_group_id,
    p_anon_id,
    p_participant_id,
    p_question_index,
    p_slide_id,
    coalesce(p_discussion_log, '[]'::jsonb)
  )
  on conflict (group_id, question_index, slide_id)
  do update
  set
    session_id = excluded.session_id,
    anon_id = excluded.anon_id,
    participant_id = excluded.participant_id,
    discussion_log = (
      select coalesce(jsonb_agg(msg order by msg->>'sent_at'), '[]'::jsonb)
      from (
        select distinct
          e as msg
        from jsonb_array_elements(
          coalesce(public.discussion_messages.discussion_log, '[]'::jsonb) ||
          coalesce(excluded.discussion_log, '[]'::jsonb)
        ) as t(e)
      ) dedup
    );
end;
$$;

grant execute on function public.upsert_discussion_log_row(
  text, text, text, text, int, text, jsonb
) to anon;

-- Optional — login-only dashboard: drop anon_select above, then enable authenticated SELECT instead.
-- drop policy if exists "authenticated_select_study_submissions" on public.study_submissions;
-- create policy "authenticated_select_study_submissions"
--   on public.study_submissions
--   for select
--   to authenticated
--   using (true);

-- Already have study_submissions? Add the column once:
-- alter table public.study_submissions
--   add column if not exists demographics jsonb not null default '{}';
-- alter table public.study_submissions
--   add column if not exists group_id text,
--   add column if not exists anon_id text,
--   add column if not exists participant_id text;
-- alter table public.discussion_messages
--   add column if not exists participant_id text,
--   add column if not exists discussion_log jsonb not null default '[]';
