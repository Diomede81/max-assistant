# Self-learning for Max: phases 0 and 1

The research report ("Self learning for Max") concluded that Max learns by curating his own memory,
not by retraining a model. This document turns its first two phases into a design against Max's code
as it is today. Phase 0 is measurement; phase 1 is the fact ledger, retrieval and the nightly
consolidation job. Phases 2 to 4 (rules from corrections, the playbook, skills, optional local
models) come after and build on what these two put in place.

## Where Max starts from

Max already has most of the foundation:

| Today | Where |
| --- | --- |
| Three encrypted vaults (personal, household, work), each a sealed JSON file with facts, conversation notes, projects and to-dos | `src/memory/memory.service.ts`, `sealed-store.ts` |
| Facts with a kind, a subject, a source (you / conversation / panel), an "unverified" flag for anything saved right after reading email or web pages, uses and last-used dates, and a local embedding | `MemoryItem` |
| Hybrid search: meaning (all-MiniLM-L6-v2 through transformers.js, on the box) plus a keyword score, over every open vault | `search()` in `memory.service.ts`, `embedder.service.ts` |
| The filing clerk: after each conversation the cloud model files notes and facts, and may update or remove facts it was shown | `memory-learner.service.ts` |
| Weekly and monthly digests of conversation notes | `memory-digest.service.ts` |
| Duplicate merging by meaning plus named anchors | `duplicates.ts` |
| An activity log of every read and write, shown on the dashboard | `activity-log.ts` |
| Mode gating (work, personal, guest) on what is readable and writable | `modes.service.ts` |

What is missing, in the research's terms: facts have no validity window and no provenance to a
conversation; a correction overwrites or deletes the old fact so history is lost; the "unverified" flag
is a hint to the reader, not a gate on what may change behaviour; search ignores time ("where did we go
last spring?"); consolidation is weekly digests only; and nothing measures whether memory is helping.

## Design decisions

**Stay on the sealed JSON vaults for now.** The report suggests SQLite with sqlite-vec, but Max's vaults
are encrypted, backed up, mode-gated and already searched in under 50 ms at a few thousand facts. A
household produces hundreds of facts a year, not hundreds of thousands. The ledger below is a change of
columns, not of storage. Moving to SQLite is a phase 1b decision, taken only if phase 0's benchmark shows
search above 100 ms at the sizes the box actually reaches.

**One write path, one trust tag.** Every fact gets `trust: 'principal' | 'external'`, set from where the
words came from, never from what they say. Only principal-trust facts can ever be promoted into rules
(phase 2). This replaces the "unverified" flag, which stays only as its display name on the dashboard.

**Supersede, never overwrite.** A fact is never edited in place. A correction creates a new fact and closes
the old one with an `invalidAt` and a `supersededBy`. The old fact stays, hidden from prompts, so "why
did you think that?" and "what did I say before?" always have an answer, and a wrong correction can be
undone.

**Deterministic where possible, the cloud model where necessary.** When a new fact has the same subject and
attribute as an existing one, Max supersedes without asking a model. Only facts with no attribute key go
through the filing clerk's judgement as today.

**Consolidation at night, on the cheapest capable model.** One job, once a night, does the chores the
research calls sleep-time work. The weekly digest stays as its last step.

## Phase 0: measure (one to two weeks)

Nothing in the research gives a Raspberry Pi figure for the embedding model or for search over Max's own
data, and nothing measures whether memory reduces corrections. Phase 0 builds the two instruments.

### 0.1 The memory benchmark

A command run on the box, `node dist/tools/memory-bench.js`, started from the dashboard (Max › Memory ›
"Run the benchmark") or from the terminal. It reports, in the log and on the dashboard:

- milliseconds per sentence for the current embedding model (all-MiniLM-L6-v2) and for bge-small-en-v1.5
  in 8-bit, both through transformers.js, warm, over 200 short sentences;
- resident memory of the Node process with each model loaded;
- search time over the real vaults, and over the vaults padded to 5,000, 20,000 and 50,000 synthetic facts;
- the recall quality of each model on a fixed set of 40 question-to-fact pairs shipped with Max
  (English and Italian), scored as "the right fact is in the top 3".

The decision rules written down before measuring: switch to bge-small if its recall is better by five
points or more and it stays under 60 ms per sentence; move to SQLite with sqlite-vec only if search at the
20,000-fact size exceeds 100 ms. Either way the result is saved in the memory settings and shown on the
dashboard, so the choice is reviewable.

### 0.2 The learning metric: corrections per task

The headline measure from the research is how often the user has to correct Max. Phase 0 starts counting
it before anything changes, so phase 1 and 2 can be judged against a real baseline.

- A correction detector runs on each conversation transcript as it is filed: consecutive user turns where
  the second starts with "no", "not that", "I meant", "I said", "non", "no, volevo" and similar, or repeats
  the first with a changed object; also any to-do, reminder or fact the user deletes or edits on the
  dashboard within ten minutes of Max creating it. Rule-based, on the box, no model.
- Each detection is logged to the activity log as "correction" with the task kind (lights, calendar, memory,
  scheduled task, people…) and the two utterances. Never the content of emails or pages.
- The dashboard's Max › Memory area gets a "Learning" card: corrections this week and last, per task kind,
  with the trend. The weekly digest mentions the number.

This detector is also the seed of phase 2, where a correction becomes a candidate rule.

### 0.3 The replay set

A fixture file in the repo, `test/memory/replay.json`, with 60 to 100 short scenarios: a sequence of user
statements over simulated dates, then a question and the expected answer, covering supersession ("my
dentist is Dr Rossi" … "I changed dentist, it's Dr Bianchi now" … "who is my dentist?"), time ("where did
we go in March?"), expiry ("the plumber comes on Tuesday" asked three weeks later), and poisoning
(a "fact" that arrived inside an email must never be answered as the user's own). A test command runs the
whole memory stack over it without a model, using the deterministic parts, and reports hit rate and stale
answers. It runs in the build's start-up check, so a regression fails the build.

## Phase 1: the fact ledger, time-aware retrieval and the nightly job (three to four weeks)

### 1.1 The ledger

`MemoryItem` gains these fields; existing facts are migrated on first load with safe defaults.

| Field | Meaning | Default on migration |
| --- | --- | --- |
| `attribute?` | What the fact is about for its subject, for deterministic supersession: "dentist", "birthday", "lives in", "car". The filing clerk fills it in; empty when there is no natural key | empty |
| `validFrom` | From when the fact holds (the user's words: "since March", else when it was learned) | `createdAt` |
| `invalidAt?` | When it stopped holding; set by supersession, expiry or the user | from `expiresAt` if set |
| `observedAt` | When the user said it (the conversation's time) | `createdAt` |
| `supersededBy?` | The id of the fact that replaced it | empty |
| `trust` | `principal` for words from the authenticated voice, WhatsApp chat with Max, or the dashboard; `external` for anything filed within ten minutes of reading email, web or messages, or that quotes them | `external` if `unverified`, else `principal` |
| `sources` | Ids of the conversation notes (episodes) the fact came from, newest first | empty |
| `confidence` | 1.0 when the user stated it; 0.6 when the filing clerk inferred it; raised by repetition | 1.0 for source "you", 0.7 otherwise |

Rules enforced in `remember()` and in the learner's filing, in code:

1. A fact with a `subject` and an `attribute` that match a live fact supersedes it: the old one gets
   `invalidAt = observedAt of the new one` and `supersededBy`, the new one inherits the old `sources` plus
   the current episode. No model call. The activity log records "superseded".
2. A fact with no attribute goes through today's path (the learner's `update`), but `update` now also
   creates a new fact and closes the old one instead of editing in place.
3. `delete` by the user closes the fact with `invalidAt = now` and a `closedBy: 'user'` marker; only the
   dashboard's "Forget for good" removes rows. "Forget everything from last Tuesday" closes every fact
   whose newest source is that day's episode.
4. A fact may only be created with `trust: 'principal'` when the turn it came from is a user turn on a
   trusted channel. The learner is given a trust tag per transcript line and passes it through; the action
   router marks facts it saves within the external-content window as `external` (today's `unverified`).
5. External facts are stored and searchable, shown with provenance, but never enter the standing "key
   facts" block of the prompt and never count towards phase 2 rules. The user can promote one from the
   dashboard ("Yes, that's right"), which sets trust to principal with `confirmedAt`.

The vault file version goes from 2 to 3; a version 2 file is migrated and written back once.

### 1.2 Retrieval

`search()` keeps its hybrid scoring and gains three things:

- **Validity.** Closed facts (`invalidAt` in the past, or `supersededBy` set) are excluded unless the query
  is about the past. The query is tagged "past" when it contains a date, a month, "last", "before", "used
  to", "ago", "previously" or the Italian equivalents, or when the user asks "what did I say". For past
  queries, closed facts are included and answered with their window: "until June your dentist was Dr Rossi".
- **Time expansion.** Relative phrases in the query ("last spring", "two weeks ago", "when we moved") are
  turned into a date range before scoring, and facts and notes inside the range get a bonus; notes outside
  a stated range are dropped. This is the LongMemEval finding, the single most replicated gain.
- **Recency and confidence in the score.** Score = meaning + 0.25 keyword + 0.1 recency (decaying over
  180 days from `observedAt`) + 0.1 confidence. Principal and external facts score alike; the difference is
  where they may appear, not whether they are found.

The standing prompt's key-facts block is built from live, principal facts only, with the same scoring.
The "Notes from memory" per-turn block says "(until …)" on a closed fact and "(from an email)" on an
external one.

### 1.3 The nightly job

A new `memory-sleep.service.ts` runs once a night (03:00 by default, after the backup) on the model
assigned to the "memory" task, with a hard budget of about 20 cloud calls. Its steps, in order, each
logged with counts:

1. **Supersede.** Any pair of live facts with the same subject and attribute (missed by the deterministic
   rule because one lacked an attribute): the clerk picks the newer by `observedAt`, closes the older.
2. **Merge.** Today's duplicate merge, now also merging `sources` and keeping the higher confidence.
3. **Expire.** Facts past `invalidAt` are closed, not deleted; facts with a date in the past and a
   "temporary" kind (a visit, a delivery, an appointment) get `invalidAt` the day after their date.
4. **Attribute back-fill.** Up to 50 live facts a night with no attribute are sent in one call for the
   clerk to label (subject, attribute), so deterministic supersession covers more each night.
5. **Reflect.** When a vault has gained ten or more notes since the last reflection, the clerk writes one
   to three insights, each a sentence with the ids of the notes it rests on, stored as episodes of a new
   level `insight`. Insights appear in the standing prompt under "What Max has noticed" and are
   superseded the same way as facts.
6. **Digest.** Today's weekly and monthly roll-up, unchanged, moved into this job.
7. **Report.** One activity-log line per vault: superseded, merged, closed, labelled, insights written;
   the dashboard's Learning card shows last night's run.

A night with nothing to do makes no cloud calls. The job never touches external-trust facts except to
close expired ones.

### 1.4 What changes on the dashboard

- Max › Memory: each fact shows its validity ("since 12 March", "until 3 June, replaced"), its trust (a
  small "from an email" badge, with a "Yes, that's right" button), and "Why?" which lists the conversation
  notes it came from.
- A "History" toggle shows closed facts greyed out, with "Restore" (reopens it and closes its successor).
- The Learning card from phase 0, now also with last night's consolidation counts.
- Settings › AI models: the "memory" task already exists; the nightly job uses it.

### 1.5 Pull requests, in order

| PR | Contents | Done when |
| --- | --- | --- |
| 1 | Memory benchmark tool, dashboard button, results stored | Numbers from the box in the log; decision rules applied automatically |
| 2 | Correction detector, "correction" activity, Learning card | A week of baseline counts visible |
| 3 | Replay fixture and test in the start-up check | Build fails on a regression |
| 4 | Ledger fields, migration, deterministic supersession, trust on the write path, dashboard history and provenance | Old vaults migrate cleanly; replay set passes supersession and poisoning scenarios |
| 5 | Time-aware retrieval and scoring | Replay set passes the time and expiry scenarios |
| 6 | Nightly job, with digests moved into it, and the Learning card's run report | A night's run logged on the box with counts; no model calls when idle |

Each PR is independent of the open ones, as usual, and each keeps the vaults readable by the previous
version until the migration PR, which is the one to merge last of the four.

## What phase 1 does not do, on purpose

No rules, playbook or skills yet: those need the correction signal from phase 0 to have a baseline. No
local model: the research shows small models fail at exactly the supersession and contradiction work this
phase needs, so that stays with the cloud clerk. No change of storage. No speaker identification: until
Max knows who is talking, the "principal" tag means "from a trusted channel", not "from Luca", and a guest
in personal mode can still teach him; night mode and guest mode remain the controls for that, and phase 2
should revisit it.

## Risks and how the design meets them

| Risk | Mitigation |
| --- | --- |
| The filing clerk labels attributes inconsistently ("dentist" vs "my dentist"), so supersession misses | Attributes are normalised (lower case, articles and possessives stripped) and drawn from a short list the clerk is shown; the nightly supersede step catches the rest |
| A wrong supersession hides a true fact | Nothing is deleted; the dashboard's Restore reopens it; the activity log shows every supersession |
| Memory poisoning through a conversation that quotes an email | Trust comes from the channel and the external-content window, not from the words; external facts never reach the standing prompt or rules |
| Nightly job costs | Hard call budget, batched calls, nothing to do means no calls; the "memory" task can be given the cheapest model |
| Migration breaks an old vault | Version 2 files are read with defaults and written back as version 3 only after a successful round trip; the backup from the night before is the fallback |
