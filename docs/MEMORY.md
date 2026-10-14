# Memory

Max keeps a long-term memory that stays organised as it grows, keeps work and private life apart,
and is encrypted on your machine.

## How it's organised

**Three vaults**, each its own encrypted file with its own key:

| Vault | What goes in it |
| --- | --- |
| **Personal** | Family, friends, health, hobbies, your preferences |
| **Household** | Things everyone at home shares: bins, appliances, house rules, home services |
| **Work** | Colleagues, clients, projects, meetings, deadlines |

Inside each vault:

- **Facts** are typed (person, preference, routine, date, project, fact) and kept current. If something
  changes ("Sofia moved to Oakwood school"), the old fact is updated rather than duplicated.
- **Dates**: birthdays repeat every year; one-off dates (a visit, a deadline) tidy themselves up
  afterwards. Anything in the next three weeks is mentioned to Max as "coming up".
- **Conversation notes**: after each conversation worth remembering, a one-line note is filed in the
  right vault. They're searched, never loaded in bulk.
- **Digests**: once a week is over (and a week old), its notes are rolled up into one weekly digest; once
  a month is over, its weekly digests become one monthly digest. A year of daily conversations ends up
  as about a dozen monthly summaries per vault, all still searchable, with names, decisions, dates and
  open items kept. (Uses the text AI model; `MEMORY_DIGESTS=off` turns it off.)

## How Max uses it

Every conversation starts with a small **core** (the most important facts, what's coming up, the last
few conversations). Everything else is **searched by meaning** when needed: "when was my daughter born"
finds "Sofia's birthday is 14 March". Search runs on the box with a small built-in model, so your
memory is never sent anywhere to be indexed. Only the few relevant notes go to the AI service with a
question, never the whole memory.

## Projects

A project groups everything about one piece of work or life: "Milan launch", "Kitchen renovation",
"Sofia's party". Each project has:

- **People**: name, role and contact ("Marco (supplier, marco@acme.com)")
- **Tasks**: due date (and optional time), who does it, priority and criticality (they are part of the
  [My Day](#my-day-the-to-do-list) to-do list). Tasks with a time are **announced out
  loud when due**; all open tasks due in the next week, or overdue, are part of Max's standing memory.
- **Its own memory**: facts and conversation notes filed under the project, so "what do we know about
  Milan?" brings back exactly that.

A project lives in a vault (Work, Personal or Household) and follows its rules: a Work project is
encrypted with the Work vault, invisible outside work mode, and its reminders wait until work mode.

| You say | Max does |
| --- | --- |
| "Create a work project called Milan launch with Marco, the supplier, and Anna, the designer" | Creates it with its people |
| "Add a task to Milan: send the budget to Marco by Wednesday, high priority" | Adds a dated task |
| "Remind me to call Marco tomorrow at 10 for the Milan project" | Adds a task with a spoken reminder |
| "What's due this week?" / "What's overdue?" / "What does Anna have to do?" | Lists tasks across projects |
| "The budget is done" | Marks the task as done |
| "Remember for Milan that the opening is 20 November" | Files it in the project's memory |
| "How's the Milan project going?" | People, open tasks and the latest project notes |
| "Add Tom from finance to Milan" / "Put the kitchen project on hold" | Updates the project |

After a conversation, Max also files notes and facts under the right project, and adds a task when you
clearly committed to one ("I'll send Anna the floor plan by Thursday").

On the control panel (**Projects**) you can create projects, tick off tasks, add people and notes, change
the status, and delete a project (with its tasks and memory; this needs a confirmation tick).

## My Day: the to-do list

One list for everything you need to do. Every item has:

- **Priority**: how soon it should be done: **high**, **medium** or **low**.
- **Criticality**: what's at stake if it slips: **critical** (real consequences), **important** or **routine**.
- Optionally a **project**: the item then also shows up as one of that project's tasks, and you can move
  it between projects (or out of one) at any time.
- Optionally a due date (with a time, Max announces it when due) and who does it.

If you don't say the priority or criticality, Max asks once ("How soon, and how critical is it?"). Say
"doesn't matter" and he uses medium and routine.

Items without a project go on your list for the current mode (Personal in personal mode, Work in work
mode); say "on the household list" for shared ones. Like everything else, work to-dos are only visible in
work mode.

| You say | Max does |
| --- | --- |
| "Add to my to-do list: renew the car insurance by Friday, high priority, critical" | Adds it |
| "Add a to-do for the Milan project: book the venue" | Asks how soon and how critical, then adds it to Milan |
| "Move the insurance to the Home admin project" / "…take it out of the project" | Reassigns it |
| "Make the venue booking critical" / "Lower the priority of…" | Updates it |
| "What's going on in my day?" / "Brief me" | Today's calendar events, reminders and to-dos, with what's critical or overdue called out |
| "What's critical?" / "What's overdue?" / "What's on my list this week?" | Lists them, most pressing first |
| "The insurance is done" | Ticks it off |

**The daily briefing** combines your calendar (from the connected Outlook or Google calendar of the current
mode, when there is one), today's reminders, and the to-dos that are overdue ("should already have been
done"), due today or critical. The rest is only counted, so the briefing stays short.

On the control panel, the **My Day** tab shows the whole list grouped into Overdue, Today, Critical and
Later, with buttons to tick items off, change their priority, criticality or project, and add new ones.

## Modes: keeping work and private life apart

| Mode | Max can use | When |
| --- | --- | --- |
| **Personal** | Personal + Household | Outside work hours |
| **Work** | Work + Household | During `WORK_HOURS` (default Mon-Fri 09:00-17:30) |
| **Guest** | Household only | When you say so, e.g. visitors are round (lasts up to 24 h) |

- Say **"Max, work mode"**, **"personal mode"**, **"guest mode"** or **"back to automatic"**. A switch
  lasts until your schedule next changes. The control panel has the same buttons.
- Personal and work are walled off from each other: outside work mode Max can't see the Work vault,
  and in work mode he can't see the Personal vault (facts, conversation notes, projects and his
  journal alike), whoever asks. Household (bins, appliances, house rules) is shared by both.
- He can still *file* a new fact into the other side (a work deadline mentioned at dinner), without
  seeing what's already there.
- **Behaviour per mode**: he also behaves differently in each mode (relaxed friend in personal mode, focused
  colleague in work mode, more reserved with guests). Edit it on the control panel → Max's soul
  (see [SOUL.md](SOUL.md)).
- **Work apps** (only needed without separate work accounts, see below: once work accounts are connected,
  Composio apps are already split by mode and this rule no longer applies to them): set `WORK_APPS=OUTLOOK_*`
  (wildcards, comma-separated) and those apps are only available
  in work mode, and what's learnt from them is filed under Work. `PERSONAL_APPS=WHATSAPP_*` does the
  reverse: those apps are hidden in work mode.
- **Separate work accounts**: connect your work email, LinkedIn etc. under *Work accounts* on the
  control panel and work mode uses only those, personal mode only your personal ones (docs/APPS.md).
- Nothing is learnt from conversations in guest mode.

## What you can say

| You say | Max does |
| --- | --- |
| "Remember that Sofia's birthday is 14 March" | Saves it in Personal, as a yearly date |
| "Remember the Acme delivery is two weeks late" | Saves it in Work |
| "When is Sofia's birthday?" / "What's the latest with Acme?" | Answers from memory (Work only in work mode) |
| "What did we talk about yesterday?" | Searches the conversation notes |
| "Forget the boiler service" | Removes it (asks which one if several match) |
| "Max, guest mode" | Hides everything but Household |

## Security

- **Encrypted at rest**: AES-256-GCM, a separate key per vault derived from `MEMORY_KEY`. Files are
  readable only by Max's user. A vault that can't be unlocked (wrong key) is left untouched, never
  overwritten.
- **Set `MEMORY_KEY` in `.env`** (`openssl rand -base64 32`) and keep a copy somewhere safe. Without it
  the vaults can't be opened. If unset, Max generates a key and stores it next to the vaults: that still
  protects copies of the vault files, but not someone with access to the whole data volume.
- **Control panel password**: set `PANEL_PASSWORD`. The panel then needs signing in (12-hour sessions;
  5 wrong attempts lock it for 5 minutes). Other websites can't post to it.
- **Secrets are refused**: passwords, PINs, alarm/door codes and account numbers are never stored.
- **No learning from emails or web pages**: Max only files what *you* say. If he saves something right
  after reading emails or web pages, it's marked **unverified** (shown with a warning on the panel and
  never part of the core) until you confirm it. This stops a malicious email from planting
  "instructions" in his memory. Memory is always given to the AI as notes, never as instructions.

## Activity log: who saw what

The control panel's **Memory activity** section lists, for the last 30 days:

- **Shared with AI**: which memories went to the AI service at the start of each conversation, and
  which were added because they were relevant to a question
- **Searched**: what Max looked up, and what he found
- **Saved / Updated / Forgot / Moved / Filed / Digest**: every change to memory and where it came from
- **Mode** switches, and **Refused** attempts to store a password or code (the secret itself is never logged)

The log is encrypted like the vaults and can be cleared from the panel.

## Upgrading from the first memory version

If Max already has memories from the first version (an unencrypted `data/memory.json`), they're imported
into the encrypted **Personal** vault on first start, and the old file is deleted. Move any facts that
belong to Household or Work on the control panel.

## Control panel

http://localhost:8099 → **Memory**: switch modes, browse each vault, search, add facts, move a fact to
another vault, confirm unverified ones, and forget anything. The panel is your own view, so it shows all
vaults whatever the mode.

## Settings (`.env`)

| Setting | Default | Meaning |
| --- | --- | --- |
| `MEMORY_KEY` | generated | Encryption secret (see Security) |
| `WORK_HOURS` | `Mon-Fri 09:00-17:30` | Automatic work mode; e.g. `Mon-Thu 08:30-18:00; Fri 08:30-13:00`, or `off` |
| `WORK_APPS` | (none) | Work app actions, e.g. `OUTLOOK_*` |
| `PANEL_PASSWORD` | (none) | Control panel password |
| `MEMORY_AUTO_LEARN` | on | `off` stops conversation filing; "remember…" still works |
| `MEMORY_DIGESTS` | on | `off` keeps every conversation note as it is |
| `MEMORY_RECENT_CONVERSATIONS` | 3 | Conversation notes in each conversation's core |
| `MEMORY_PROMPT_CHARS` | 2000 | Size of the core fact list |
| `MEMORY` | on | `off` turns memory off |

## What survives a restart

Everything Max keeps is saved straight away to the `max-assistant_max-data` storage, which survives
restarts, rebuilds and updates:

- memories, conversation notes, projects and their tasks (the encrypted vaults);
- **timers and reminders** (`timers.vault`, encrypted). Reminders can be set up to a year ahead
  ("remind me on 3 March to renew the insurance"). If one came due while Max was switched off, he
  tells you when he's back: *"While I was switched off, I missed your reminder…"* (reminders up to a
  day late; kitchen timers up to 30 minutes).

Only the current conversation itself is short-lived: after a restart, start a new one.

**Memories gone after an update?** Earlier versions kept them in storage named after the folder Max
ran from, so running Max from a differently named folder (e.g. a fresh download unzips as
`max-assistant-main`) started an empty memory. That no longer happens. To find and bring back the old
memories:

```bash
./scripts/find-memory.sh                      # lists every memory store and its files
./scripts/find-memory.sh restore NAME         # copies that store into the one Max uses (keeps a backup)
```

## Backup

```bash
docker compose cp max:/app/data ./max-memory-backup     # encrypted vaults (+ memory.key if generated)
```

Restore by copying the folder back and restarting Max with the same `MEMORY_KEY`.

## Troubleshooting

- **"vault cannot be unlocked"** in the log: `MEMORY_KEY` changed. Put the original key back; Max never
  overwrites a vault it can't open.
- **"Meaning search unavailable"**: the search model wasn't downloaded during the build (no internet at
  the time). Memory still works with keyword search; rebuild with `docker compose build max`.
- **"Could not file this conversation"**: the text AI model (`LLM_*`) isn't reachable. "Remember…" still
  works.
- **Max filed something in the wrong vault**: move it on the control panel.
