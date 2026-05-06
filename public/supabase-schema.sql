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

alter table public.discussion_messages enable row level security;

drop policy if exists "anon_insert_discussion_messages" on public.discussion_messages;
create policy "anon_insert_discussion_messages"
  on public.discussion_messages
  for insert
  to anon
  with check (true);

-- Optional: allow dashboard/analysis reads directly from the browser.
drop policy if exists "anon_select_discussion_messages" on public.discussion_messages;
create policy "anon_select_discussion_messages"
  on public.discussion_messages
  for select
  to anon
  using (true);

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
