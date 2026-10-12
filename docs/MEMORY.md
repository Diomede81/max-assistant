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

## Modes: keeping work and private life apart

| Mode | Max can use | When |
| --- | --- | --- |
| **Personal** | Personal + Household | Outside work hours |
| **Work** | Work + Personal + Household | During `WORK_HOURS` (default Mon-Fri 09:00-17:30) |
| **Guest** | Household only | When you say so, e.g. visitors are round (lasts up to 24 h) |

- Say **"Max, work mode"**, **"personal mode"**, **"guest mode"** or **"back to automatic"**. A switch
  lasts until your schedule next changes. The control panel has the same buttons.
- Outside work mode, Max won't use or mention anything from the Work vault, whoever asks.
- **Work apps**: set `WORK_APPS=OUTLOOK_*` (wildcards, comma-separated) and those apps are only available
  in work mode, and what's learnt from them is filed under Work.
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
