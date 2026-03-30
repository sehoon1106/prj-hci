# Memory Study (visual memory user study web app)

Static web application to reproduce the **online user-study procedure** from the CHI ’25 paper *Synthetic Human Memories: AI-Edited Images and Videos Can Implant False Memories and Distort Recollection* (Pataranutaporn et al.). Surveys, images, and filler tasks can be swapped by editing JSON under `public/config/` only.

## Stack

- React 19 + TypeScript + Vite 8  
- Optional [Supabase](https://supabase.com/) for storing responses and event logs on static hosting (e.g. GitHub Pages)

## Quick start

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (default `http://localhost:5173`).

```bash
npm run build   # production build → dist/
npm run preview # preview dist
```

## Study flow

1. Consent and introduction  
2. **Pre-survey** + first attention check (`pre-survey.json`)  
3. **Original images** (15) — swipe or buttons; when **minimum time (default 60s)** elapses, the app **advances automatically** (no manual continue button)  
4. **Filler** — default ~1 min Pac-Man (`filler.json`, `type: "pacman"`)  
5. **Second attention check** (`attention-2.json`)  
6. **Condition-specific second stimulus** — previous/next only (no return to baseline); after **minimum time** (`conditionDurationSeconds` in `study.json`, default 60s) the app advances automatically; copy and labels from `study.json`  
7. **Memory test** (15 items) — Agree / Disagree / Not sure + confidence 1–7 (`memory-items.json`)  
8. **Post-survey** (`post-survey.json`)  
9. On completion — **submit** (Supabase or JSON download)

Participants are **randomly assigned** to one of two conditions at session start: `no_edit`, `ai_edited_image` (`conditionKeys` / `randomizeCondition` in `study.json`).

## Config files (`public/config/`)

| File | Role |
|------|------|
| `study.json` | Title, instructions, baseline minimum duration (seconds), condition keys/labels, phase titles |
| `pre-survey.json` | Pre-survey pages and items (attention MC, etc.) |
| `attention-2.json` | Attention check after filler |
| `post-survey.json` | Demographics and post scales |
| `filler.json` | Filler title, copy, minimum duration (seconds). If `type` is not `"pacman"`, a **simple countdown** filler is used |
| `slides.json` | Slides (default 12): baseline URL, per-condition URLs, per-condition media type (`image` / `video`) |
| `memory-items.json` | Per-item `slideId`, masked image URL, question text |

Default images use [placehold.co](https://placehold.co) URLs. Replace URLs and copy in the JSON for your own stimuli.

### Survey item types (`pre-survey` / `post-survey` / `attention-2`)

- `attention_mc` — options + `correctValue` (wrong answer blocks progress)  
- `likert7` — 1–7 scale  
- `single_choice`, `text`, `number`  

## Data storage

### Supabase (recommended for multi-participant studies)

1. Create a Supabase project  
2. Run `public/supabase-schema.sql` in the SQL editor (table `study_submissions` + anon `INSERT` policy)  
3. Create `.env` in the project root (see `.env.example`)

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

4. `npm run build` and deploy (env vars are **baked in at build time**)

**Troubleshooting:** The app only reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the browser. Names like `SUPABASE_URL` without the `VITE_` prefix are ignored by Vite unless you rely on the mapping in `vite.config.ts`. After editing `.env`, **restart** `npm run dev`. Run `public/supabase-schema.sql` so the table and `anon` INSERT policy exist; insert errors still trigger a JSON download—check the browser console and the on-screen error line.

Stored columns include pre/attention2/post survey objects, memory response array, **event log** (`event_log`), filler stats, etc., as JSON.

### Without Supabase

On completion the browser **downloads a JSON file** automatically; surveys and logs are inside.

Each full **page load** gets a new `session_id`, so repeating the study on the same computer (refresh or open the URL again) **submits as a new row** / new download. Only the same visit blocks double-submit after a successful save.

## Interpreting saved results

One row (Supabase) or one downloaded JSON object = **one participant session** (one full run through the study).

### Top-level fields

| Field (JSON download) | Supabase column | Meaning |
|----------------------|-----------------|--------|
| `schemaVersion` | `schema_version` | Payload format version (currently `1`) |
| `sessionId` | `session_id` | Unique ID for this run (UUID string) |
| `conditionKey` | `condition_key` | Assigned stimulus condition: `no_edit` or `ai_edited_image` |
| `submittedAt` | `submitted_at` | ISO timestamp when submit ran |
| `userAgent` | `user_agent` | Browser user-agent string |
| `preSurvey` | `pre_survey` | Object: keys = item `id` from `pre-survey.json`, values = participant answer (string or number) |
| `attention2` | `attention2` | Same shape for `attention-2.json` |
| `postSurvey` | `post_survey` | Same shape for `post-survey.json` |
| `memoryResponses` | `memory_responses` | Array of memory trials (see below) |
| `eventLog` | `event_log` | Array of timestamped events (see below) |
| `fillerStats` | `filler_stats` | Object: filler task summary (Pac-Man stats or countdown metadata) |

Survey answers are **not** labeled by question text in the file—only by **`id`** from the JSON config (e.g. `age`, `gender`, `att_check_1`). Open `public/config/*.json` to map ids → prompts and options.

### `memoryResponses` (memory test)

Each element:

| Key | Meaning |
|-----|--------|
| `itemIndex` | 0-based index in `memory-items.json` **array order** (stable; joins to the n-th item in the file) |
| `presentationIndex` | 0-based position in the **randomized** memory block order that session |
| `slideId` | Matches `slideId` in `memory-items.json` / `slides.json` (links to which image the question referred to) |
| `recall` | `"agree"`, `"disagree"`, or `"unsure"` |
| `confidence` | Integer 1–7 |

For analysis vs ground truth, set `expectedAnswer` in `memory-items.json` per item (`agree` / `disagree`) and compare to `recall`.

### `filler_stats` (what it is and how to read it)

`filler_stats` is a **single JSON object** saved on the final payload. It summarizes the **filler phase only** (the task between baseline and attention-check 2)—not the whole study.

**Normal completion — Pac-Man** (`filler.json` has `"type": "pacman"`), using the `react-pacman` embed:

| Key | Type | Meaning |
|-----|------|--------|
| `type` | string | `"pacman"` |
| `dotsEaten` | number | Same as **`maxPacmanScore`** (kept for backward compatibility) |
| `maxPacmanScore` | number | Highest on-screen score in this filler (across restarts / rounds) |
| `pacmanRoundScores` | number[] | Final score after each completed round (each “다시 하기” snapshots the prior round; the filler timer appends the last round) |
| `durationMs` | number | Milliseconds from “Start game” until the filler ended (≈ configured minimum × 1000) |
| `keyStrokes` | number | Arrow / WASD presses counted during the filler |
| `gameLibrary` | string | `"react-pacman"` |
| `fillerEndPacmanScore` | number | (optional) Score captured when the filler timer hit zero; can be lower than `maxPacmanScore` if an earlier round was higher |

**Maximum score:** `maxPacmanScore` / `dotsEaten` are `Math.max` over every completed round plus the **buzzer** score (last moment of the filler, including mid-game if the timer ends before game over).

Example:

```json
{
  "type": "pacman",
  "dotsEaten": 142,
  "maxPacmanScore": 142,
  "pacmanRoundScores": [80, 142],
  "fillerEndPacmanScore": 142,
  "durationMs": 60100,
  "keyStrokes": 89,
  "gameLibrary": "react-pacman"
}
```

**Normal completion — countdown filler** (any `type` other than `"pacman"`):

```json
{ "type": "countdown", "durationSeconds": 120 }
```

(`type` is whatever you set in `filler.json`; `durationSeconds` is the configured minimum.)

**Debug skip** (“Skip filler timer”): the object marks that the participant did not complete the real task, e.g.

```json
{ "type": "pacman", "debugSkip": true, "note": "Debug: filler duration skipped" }
```

or for non–Pac-Man: `{ "type": "<your type>", "durationSeconds": 120, "debugSkip": true }`.

**Relationship to `event_log`:** When the filler finishes normally, the app also appends an event `filler_complete` whose `payload` is the **same numbers** as above (Pac-Man) or `{ "type": "..." }` (countdown). So you can analyze engagement from **`filler_stats`** alone; use **`event_log`** if you want timestamps or to align filler with other events.

---

### `event_log` (what it is and how to read it)

`event_log` is an **ordered list of events** (array). Each item has:

- **`t`** — ISO-8601 time when the event was recorded (sort by this to get a timeline).  
- **`type`** — short string label (see table below).  
- **`payload`** — optional object with details for that event (can be empty or missing).

**How to use it in practice**

1. **Reconstruct procedure:** Filter `type === "phase_enter"` and read `payload.phase` to see order and when they entered each stage.  
2. **Stimulus exposure:** `baseline_slide` / `condition_slide` give which `slideId` and `index` were shown when they navigated (rough “which images were visited”).  
3. **Durations:** Subtract `t` between two events (e.g. first `phase_enter` with `phase: "baseline"` and `baseline_complete`) to approximate time on task.  
4. **Compliance / attention:** `survey_validation_fail` = failed an attention check; many failures may mean exclude.  
5. **Dedup with final tables:** `memory_answer` duplicates what’s in `memory_responses` but is **time-stamped per click**—useful for RT-style or order analyses.

**Event types reference**

| `type` | Typical `payload` | Use |
|--------|-------------------|-----|
| `session_start` | `sessionId`, `condition`, `userAgent`, `presentationOrders` | Start of run; **`presentationOrders`** maps each phase’s screen order → config indices for that session |
| `phase_enter` | `phase` | e.g. `pre_survey`, `baseline`, `filler`, `condition`, `memory`, `complete` |
| `baseline_slide` | `slideId`, `presentationIndex`, `configSlideIndex` | Baseline navigation (**`configSlideIndex`** = row in `slides.json`; first slide may log only after navigating away) |
| `baseline_complete` | `elapsed`, `maxIdx`, optional `autoAdvanceAfterMinDuration`, `debugSkip` | End of baseline |
| `condition_slide` | `slideId`, `presentationIndex`, `configSlideIndex`, `condition`, `media`, `src` | Second-stimulus set |
| `condition_complete` | `condition`, optional `debugSkip` | Finished condition block |
| `memory_answer` | `step`, `presentationIndex`, `configItemIndex`, `slideId`, `recall`, `confidence` | One memory item (mirror of `memoryResponses`; **`configItemIndex`** matches `memory-items.json` order) |
| `filler_complete` | Same shape as `filler_stats` (Pac-Man) or `{ type }` (countdown) | End of filler; **redundant** with `filler_stats` for summary stats |
| `survey_page_done` | `surveyId`, `pageId` | Finished a survey page |
| `survey_validation_fail` | `surveyId`, `pageId`, `message` | Failed validation (attention check, required field, etc.) |
| `survey_debug_skip_entire` | `surveyId`, `pageId`, `pageIndex` | Debug skip |
| `intro_debug_skip`, `baseline_debug_skip`, `filler_debug_skip`, `condition_debug_skip`, `memory_phase_debug_skip`, `complete_debug_reload` | (varies) | **Pilot only**—filter out in real data |
| `submit_start` / `submit_done` | — | Final save started / finished |

**Supabase / SQL:** `event_log` is stored as **jsonb**. Example: count filler completions per session —  
`select session_id, jsonb_array_length(event_log) from study_submissions;`  
To filter events you typically `jsonb_array_elements(event_log)` in Postgres or export and parse in Python/R.

### Quick analysis tips

1. **Between-subjects factor:** `condition_key` (`no_edit` vs `ai_edited_image` in the second block).  
2. **Merge memory with stimuli:** join `memoryResponses[].slideId` with `slides.json` and the participant’s `condition_key` to know which URL they studied.  
3. **Quality filters:** drop sessions with `survey_debug_skip_entire`, `baseline_debug_skip`, etc., if you used debug buttons during data collection.  
4. **Supabase export:** Table Editor → Export, or SQL `select * from study_submissions` — JSON columns parse as nested objects in most tools.

## GitHub Pages

If the repo name appears in the URL (e.g. `https://user.github.io/repo-name/`), set the base path before building:

```env
VITE_BASE_PATH=/repo-name/
```

`vite.config.ts` reads `VITE_BASE_PATH` for Vite `base`. For a user site root (`user.github.io`), keep the default `/`.

Stimulus URLs in JSON stay as `/stimuli/...`; at runtime `assetUrl()` prefixes `import.meta.env.BASE_URL` so images and videos load under the same subpath as the app. **The production build must still set `VITE_BASE_PATH` to match the Pages URL** (e.g. `/memory-study/`), or assets will 404.

Point Pages at `dist` or use Actions to run `npm run build` and upload artifacts.

## Project layout (summary)

```
scripts/compress-stimuli.mjs   # npm run compress-stimuli — batch resize/compress public/stimuli (sharp)
public/config/          # Study definition (replaceable)
public/supabase-schema.sql
src/
  components/           # StudyFlow, surveys, filler, media phases
  session/              # Session, log, submit
  services/submitResults.ts
  lib/loadStudyConfig.ts
  types/study.ts
```

## License and ethics

For real human-participant research you still need institutional IRB, informed consent, debriefing as required, etc. This repo is a sample implementation and is **not** an official tool from the paper authors.

## Reference

Pat Pataranutaporn, Chayapatr Archiwaranguprok, Samantha W. T. Chan, Elizabeth Loftus, Pattie Maes. *Synthetic Human Memories: AI-Edited Images and Videos Can Implant False Memories and Distort Recollection.* CHI ’25. DOI: [10.1145/3706598.3713697](https://doi.org/10.1145/3706598.3713697)
