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
  filler_stats jsonb not null default '{}'
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
