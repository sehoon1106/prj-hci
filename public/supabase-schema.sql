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

alter table public.study_submissions add column if not exists group_condition_by_slide jsonb;
alter table public.study_submissions add column if not exists group_condition_exposure_table jsonb;

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
  discussion_log jsonb not null default '[]',
  condition_exposure jsonb
);

alter table public.discussion_messages add column if not exists condition_exposure jsonb;

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
  p_discussion_log jsonb,
  p_condition_exposure jsonb default null
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
    discussion_log,
    condition_exposure
  ) values (
    p_session_id,
    p_group_id,
    p_anon_id,
    p_participant_id,
    p_question_index,
    p_slide_id,
    coalesce(p_discussion_log, '[]'::jsonb),
    p_condition_exposure
  )
  on conflict (group_id, question_index, slide_id)
  do update
  set
    session_id = excluded.session_id,
    anon_id = excluded.anon_id,
    participant_id = excluded.participant_id,
    condition_exposure = coalesce(
      public.discussion_messages.condition_exposure,
      excluded.condition_exposure
    ),
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
  text, text, text, text, int, text, jsonb, jsonb
) to anon;

-- Incremental memory answers (one merged row per browser session).
create unique index if not exists study_submissions_session_id_unique
  on public.study_submissions (session_id);

drop policy if exists "anon_update_study_submissions" on public.study_submissions;
create policy "anon_update_study_submissions"
  on public.study_submissions
  for update
  to anon
  using (true)
  with check (true);

create or replace function public.upsert_study_memory_answer(
  p_session_id text,
  p_group_id text,
  p_anon_id text,
  p_participant_id text,
  p_condition_key text,
  p_answer jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.study_submissions (
    session_id,
    condition_key,
    submitted_at,
    group_id,
    anon_id,
    participant_id,
    memory_responses
  ) values (
    p_session_id,
    p_condition_key,
    now(),
    nullif(trim(p_group_id), ''),
    nullif(trim(p_anon_id), ''),
    nullif(trim(p_participant_id), ''),
    coalesce(jsonb_build_array(p_answer), '[]'::jsonb)
  )
  on conflict (session_id)
  do update
  set
    group_id = coalesce(excluded.group_id, public.study_submissions.group_id),
    anon_id = coalesce(excluded.anon_id, public.study_submissions.anon_id),
    participant_id = coalesce(
      excluded.participant_id,
      public.study_submissions.participant_id
    ),
    memory_responses = (
      select coalesce(
        jsonb_agg(elem order by sort_pres),
        '[]'::jsonb
      )
      from (
        select distinct on (
          coalesce(elem->>'memoryRound', ''),
          coalesce((elem->>'presentationIndex')::int, -1)
        )
          elem,
          coalesce((elem->>'presentationIndex')::int, 0) as sort_pres
        from jsonb_array_elements(
          coalesce(jsonb_build_array(p_answer), '[]'::jsonb) ||
          coalesce(public.study_submissions.memory_responses, '[]'::jsonb)
        ) as t(elem)
        order by
          coalesce(elem->>'memoryRound', ''),
          coalesce((elem->>'presentationIndex')::int, -1)
      ) merged
    );
end;
$$;

grant execute on function public.upsert_study_memory_answer(
  text, text, text, text, text, jsonb
) to anon;

-- Cross-client per-step coordination signals (end-of-discussion vote, answer ack, etc).
-- DB acts as a reliable fallback when Realtime broadcasts/presence drop or get rate-limited.
-- `session_id` scopes a signal to a single study session — without it, rows from a previous
-- test run with the same `group_id` would prematurely satisfy quorum on a fresh run.
create table if not exists public.group_step_signals (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  group_id text not null,
  session_id text,
  presentation_index int not null,
  signal_type text not null,
  anon_id text not null
);

-- Backfill column for pre-existing deployments (idempotent).
alter table public.group_step_signals add column if not exists session_id text;

-- Old unique index (without session_id) blocks legitimate per-session inserts; replace it.
drop index if exists public.group_step_signals_unique;
create unique index if not exists group_step_signals_unique
  on public.group_step_signals (group_id, session_id, presentation_index, signal_type, anon_id);

create index if not exists group_step_signals_lookup
  on public.group_step_signals (group_id, presentation_index, signal_type);

create index if not exists group_step_signals_session_lookup
  on public.group_step_signals (group_id, session_id, presentation_index, signal_type);

alter table public.group_step_signals enable row level security;

drop policy if exists "anon_select_group_step_signals" on public.group_step_signals;
create policy "anon_select_group_step_signals"
  on public.group_step_signals
  for select
  to anon
  using (true);

drop policy if exists "anon_insert_group_step_signals" on public.group_step_signals;
create policy "anon_insert_group_step_signals"
  on public.group_step_signals
  for insert
  to anon
  with check (true);

-- Old 4-arg signature lingered in pg_proc on dev DBs; drop it so PostgREST resolves the new one.
drop function if exists public.record_group_step_signal(text, int, text, text);

create or replace function public.record_group_step_signal(
  p_group_id text,
  p_session_id text,
  p_presentation_index int,
  p_signal_type text,
  p_anon_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_step_signals (
    group_id,
    session_id,
    presentation_index,
    signal_type,
    anon_id
  ) values (
    nullif(trim(p_group_id), ''),
    nullif(trim(p_session_id), ''),
    p_presentation_index,
    nullif(trim(p_signal_type), ''),
    nullif(trim(p_anon_id), '')
  )
  on conflict (group_id, session_id, presentation_index, signal_type, anon_id) do nothing;
end;
$$;

grant execute on function public.record_group_step_signal(text, text, int, text, text) to anon;

notify pgrst, 'reload schema';

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
