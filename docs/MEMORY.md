# Memory

Max remembers things between conversations: who is who in the household, preferences, routines,
important dates, and what you talked about recently. Everything stays on your machine in one file,
and you can see, add and delete it on the control panel (http://localhost:8099 → **Memory**).

## What you can say

| You say | Max does |
| --- | --- |
| "Remember that Sofia's birthday is 14 March" | Saves it as a fact |
| "When is Sofia's birthday?" | Already knows: facts are part of every conversation |
| "What did we talk about yesterday?" | Uses his notes of recent conversations |
| "Do you remember anything about the boiler?" | Searches every fact and every past conversation |
| "Forget the boiler service" | Removes that fact (asks which one if several match) |

He also saves lasting details you mention in passing ("my sister Anna is visiting in December"),
so you don't always have to say "remember".

## How it works

1. **Facts** are loaded into every conversation, so Max uses them without any delay. The newest
   facts come first if the list gets long (`MEMORY_PROMPT_CHARS`, default 3000 characters, about
   40 facts); older ones are still found when he searches.
2. **Conversation notes**: when a conversation ends, Max asks the text AI model (`LLM_*` settings)
   for a one-line note of what was discussed, plus any new lasting facts. This happens in the
   background after the conversation, so it never slows a reply down. Quick commands ("lights on",
   "what time is it") don't get a note. The last 5 notes (`MEMORY_RECENT_CONVERSATIONS`) are part of
   every conversation; all of them can be searched.
3. Works in both voice modes (normal and real-time with OpenAI or Gemini) and in typing mode
   (`docker compose run --rm max node dist/tools/chat.js`, which saves its note when you quit).
   In OpenAI real-time mode, notes only include your own words if `REALTIME_TRANSCRIBE_MODEL` is set;
   otherwise they are based on Max's replies.

## Privacy and safety

- Stored in the `max-data` Docker volume (`/app/data/memory.json` inside the container). It survives
  restarts and rebuilds. `docker compose down -v` deletes it.
- Memory is sent to the AI service with each conversation, like everything else you say to Max, so
  **passwords, PINs, alarm or door codes and account numbers are refused** and never stored.
- The control panel only accepts changes from its own page, so other websites can't plant a "memory".

## Settings (`.env`)

| Setting | Default | Meaning |
| --- | --- | --- |
| `MEMORY` | on | `off` turns memory off completely |
| `MEMORY_AUTO_LEARN` | on | `off` stops conversation notes and automatic facts; "remember …" still works |
| `MEMORY_RECENT_CONVERSATIONS` | 5 | Conversation notes Max sees at the start of each conversation |
| `MEMORY_PROMPT_CHARS` | 3000 | How much of the fact list goes into each conversation |
| `MEMORY_FILE` | `data/memory.json` | Where the file lives |

## Backup and editing by hand

```bash
docker compose cp max:/app/data/memory.json ./memory-backup.json   # backup
docker compose cp ./memory-backup.json max:/app/data/memory.json   # restore, then restart Max
```

The file is plain JSON (`facts` and `conversations`), so it can be edited by hand while Max is stopped.

## Troubleshooting

- **"Could not write a conversation note"** in the log: the text AI model (`LLM_BASE_URL`,
  `LLM_API_KEY`, `LLM_MODEL`) isn't reachable. Facts you ask Max to remember still work. Fix the
  `LLM_*` settings, or set `MEMORY_AUTO_LEARN=off`.
- **Max learnt something wrong**: delete it on the control panel, or say "forget …".
