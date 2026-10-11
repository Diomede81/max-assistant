# Real-time voice (OpenAI Realtime)

In real-time mode, Max hears your voice directly and answers with his own voice, using one
OpenAI model instead of three separate steps (speech-to-text → AI → text-to-speech).
The result is the most natural conversation Max can have: faster, with natural intonation,
and it copes well with "umm"s and rephrasing.

| | Normal mode (`pipeline`) | Real-time mode (`realtime`) |
|---|---|---|
| Feel | Good | Most natural, best for demos |
| Response time | ~1–2 s | Typically under a second |
| Cost | Pennies per day | Pay per minute of conversation (see below) |
| Wake word | Local, free | Local, free (OpenAI is only connected **after** "Hey Jarvis") |
| Home Assistant, time, timers | ✓ | ✓ (same actions) |
| Works without internet | With a local fallback model | No |

## Set it up (2 minutes)

1. Get an API key at https://platform.openai.com/api-keys. The account needs billing set up.
2. Add to `.env`:
   ```
   VOICE_MODE=realtime
   REALTIME_API_KEY=sk-...your key...
   REALTIME_VOICE=cedar
   ```
3. Restart Max:
   ```bash
   docker compose --profile max up -d --build
   ```
   ```bash
   docker compose logs -f max
   ```
   The log should show `Voice mode: OpenAI Realtime (gpt-realtime-2, voice "cedar")`.
4. Say "Hey Jarvis" and talk normally. After each answer the log shows
   `voice-to-voice NNN ms`, the time from the end of your sentence to Max starting to speak.

## Make it yours

| Setting | What it does |
|---|---|
| `REALTIME_VOICE` | `cedar` (male) and `marin` (female) are OpenAI's most natural voices. Others: `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `alloy` |
| `REALTIME_STYLE` | Personality and delivery, e.g. `Speak with a warm, calm British accent, like a witty butler.` |
| `REALTIME_SILENCE_MS` | How long a pause means "I'm done" (default 500). Lower = snappier, but may cut you off |
| `REALTIME_FOLLOW_UP_MS` | How long Max keeps listening for a follow-up before hanging up (default 8000) |
| `REALTIME_WAKE_INTERRUPT` | `on` (default): say the wake word while Max is talking to cut him off and ask something else. Works on normal speakers |
| `REALTIME_BARGE_IN=on` | Lets you interrupt Max mid-sentence. **Use only with headphones** (or a speakerphone with echo cancellation): otherwise Max hears his own voice and interrupts himself |
| `REALTIME_TRANSCRIBE_MODEL` | Set to e.g. `gpt-4o-mini-transcribe` to also log what you said (small extra cost) |

Switch back any time with `VOICE_MODE=pipeline`.

## Interrupting Max

- **On speakers (default):** say **"Hey Jarvis"** while Max is talking. He stops at once, the rest of
  his answer is cancelled, and he listens to what you say next ("Hey Jarvis… actually, just turn off
  the lights"). Max never says the wake word himself, so his own voice can't trigger this.
- **With headphones:** set `REALTIME_BARGE_IN=on` and simply start talking over him, like a phone call.
  Don't use this on speakers: Max would hear his own voice and keep cutting himself off.

## Cost

OpenAI charges per minute of audio in and out. Published third-party estimates for
`gpt-realtime-2` are roughly **$0.15–0.20 per minute of conversation**. Check
https://openai.com/api/pricing for current prices. To keep costs down, Max:
- only connects after the wake word (the always-on listening is local and free),
- hangs up after `REALTIME_FOLLOW_UP_MS` of quiet,
- never keeps a session open longer than `REALTIME_MAX_SESSION_S` (default 5 minutes).

Set a monthly spending limit in your OpenAI account settings before a demo.

## Troubleshooting

| Log line | Fix |
|---|---|
| `refused the connection (401)` | Wrong or revoked key in `REALTIME_API_KEY` |
| `refused the connection (403/404)` / model errors | Your account may not have access to `REALTIME_MODEL`; try another realtime model from your OpenAI dashboard |
| `Conversation ended (no request heard…)` | Speak within ~7 s of the wake word; check the mic with `mic-check` |
| Max cuts himself off / answers himself | Turn `REALTIME_BARGE_IN` off, or use headphones |
