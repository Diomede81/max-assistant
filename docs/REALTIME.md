# Real-time voice (OpenAI Realtime or Gemini Live)

In real-time mode, Max hears your voice directly and answers with his own voice, using one
speech-to-speech model instead of three separate steps (speech-to-text → AI → text-to-speech).
Two providers are supported:

| | OpenAI Realtime | **Gemini Live** |
|---|---|---|
| Setting | `REALTIME_PROVIDER=openai` (default) | `REALTIME_PROVIDER=gemini` |
| Default model / voice | `gpt-realtime-2` / `cedar` | `gemini-3.8-live` / `Charon` |
| Approx. cost | ~$0.05–0.20 per minute of conversation | **~$0.01–0.02 per minute** |
| Key from | platform.openai.com | aistudio.google.com |

Everything else is identical in both: the local wake word, interrupting with "Hey Jarvis", echo
protection, Home Assistant, timers, apps and the spoken "yes" before risky actions.

## Gemini Live set-up (5 minutes)

1. Go to https://aistudio.google.com → **Get API key** → **Create API key**, and enable billing
   for the key's Google Cloud project (the free tier is too limited for voice).
2. Add to `.env`:
   ```
   VOICE_MODE=realtime
   REALTIME_PROVIDER=gemini
   GEMINI_API_KEY=...your key...
   ```
   If you used OpenAI before, **remove or comment out `REALTIME_MODEL` and `REALTIME_VOICE`**
   (OpenAI names like `cedar` don't exist on Gemini), or set Gemini ones.
3. Restart: `docker compose --profile max up -d --build`
4. Check: `docker compose logs max | grep "Voice mode"` shows
   `Voice mode: Gemini Live (gemini-3.8-live, voice "Charon")`.

**Gemini voices** (`REALTIME_VOICE`): `Charon` (male, informative), `Puck` (male, upbeat),
`Fenrir`, `Orus`, `Kore` (female, firm), `Aoede`, `Leda`, `Zephyr` and more; try them in Google
AI Studio's Live/Stream page. For a British accent, keep the British style in `REALTIME_STYLE`
and optionally set `REALTIME_LANGUAGE=en-GB`.

If a voice or model name isn't available to your account, the log shows Google's reason
(e.g. `Could not start the Gemini Live session: …`) and Max carries on in wake-word mode.

## Real-time vs normal mode

The result is the most natural conversation Max can have: faster, with natural intonation,
and it copes well with "umm"s and rephrasing.

| | Normal mode (`pipeline`) | Real-time mode (`realtime`) |
|---|---|---|
| Feel | Good | Most natural, best for demos |
| Response time | ~1–2 s | Typically under a second |
| Cost | Pennies per day | Pay per minute of conversation (see below) |
| Wake word | Local, free | Local, free (the provider is only connected **after** "Hey Jarvis") |
| Home Assistant, time, timers, apps | ✓ | ✓ (same actions) |
| Works without internet | With a local fallback model | No |

## OpenAI set-up

1. Get an API key at https://platform.openai.com/api-keys. The account needs billing set up.
2. Add to `.env`:
   ```
   VOICE_MODE=realtime
   REALTIME_PROVIDER=openai
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

**Easiest:** on the control panel, **Settings → Voice & wake word**: pick a voice, optionally describe how he
speaks, press **▶ Try it on Max** to hear a sample on the box, then **Save**. That overrides `REALTIME_VOICE` /
`REALTIME_STYLE`. The "Hey Max" greeting is recorded once in the chosen voice (a few seconds after starting or
saving) and replayed instantly from then on; until then the standard voice says it. Reminders, timers and
other announcements are also said in the chosen voice (recorded while the two chimes play); if that can't be
done within 10 seconds, the standard voice says them, so none is ever missed.


| Setting | What it does |
|---|---|
| `REALTIME_VOICE` | `cedar` (male) and `marin` (female) are OpenAI's most natural voices. Others: `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `alloy` |
| `REALTIME_STYLE` | Personality and delivery, e.g. `Speak with a warm, calm British accent, like a witty butler.` |
| `REALTIME_SILENCE_MS` | How long a pause means "I'm done" (default 1000; Settings → Device overrides it). Lower = snappier, but may cut you off; longer (1.5–4 s) lets you think mid-sentence when dictating |
| `REALTIME_END_OF_SPEECH` | `relaxed` (default): Gemini waits through hesitations before deciding you've finished; `quick`: decides sooner, for one-line commands |
| `REALTIME_FOLLOW_UP_MS` | How long Max keeps listening for a follow-up before hanging up (default 8000) |
| `REALTIME_WAKE_INTERRUPT` | `on` (default): say the wake word while Max is talking to cut him off and ask something else. Works on normal speakers |
| `REALTIME_BARGE_IN=on` | Lets you interrupt Max mid-sentence. **Use only with headphones** (or a speakerphone with echo cancellation): otherwise Max hears his own voice and interrupts himself |
| `REALTIME_TRANSCRIBE_MODEL` | Set to e.g. `gpt-4o-mini-transcribe` to also log what you said (small extra cost) |

Switch back any time with `VOICE_MODE=pipeline`.

## Taking turns: when Max decides you've finished

Three things decide when Max answers, all under Settings → Device:

1. **The pause** ("A pause of … means you've finished"). Gemini ends your turn after that much silence. It is also told to be slow to call a hesitation a pause (`REALTIME_END_OF_SPEECH=relaxed`).
2. **The grace window** ("If you carry on within … Max stays quiet"). Max's answer is held back that long after your pause, with the microphone still open. Speak again inside it and the answer is dropped unheard: Max just keeps listening, and the voice model is told nobody heard it, so the next answer stands on its own. Every answer starts that much later, so keep it short (0.8 s is the default; "no time" switches it off).
3. **The follow-up wait** ("After he answers, stop listening when nothing more is said for …").

For telling him about your day, set the pause to 1.5–2 s and the grace window to 1.2 s. For quick commands, 0.8 s and 0.5 s.

The log traces each of these: `[voice +12.3s] you carried on within the 800 ms grace window: Max's answer (1400 ms of speech, still arriving) dropped unheard, still listening`.

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
- hangs up when nothing more is *said* for a while after his answer (Settings → Device: 4 to 20 seconds,
  default `REALTIME_FOLLOW_UP_MS`). Only your words count: a stretch of sound that ends without any words
  (a TV, people talking across the room) doesn't keep him listening. While you are talking he never hangs
  up, however long the sentence; and a first request that never comes ends it after 7 seconds,
- ends a long session at the next quiet moment after `REALTIME_MAX_SESSION_S` (default 15 minutes), never
  mid-sentence or mid-answer.

Set a monthly spending limit in your OpenAI account settings before a demo.

## Troubleshooting

| Log line | Fix |
|---|---|
| `refused the connection (401)` | Wrong or revoked key in `REALTIME_API_KEY` |
| `refused the connection (403/404)` / model errors | Your account may not have access to `REALTIME_MODEL`; try another realtime model from your OpenAI dashboard |
| `Conversation ended (no request heard…)` | Speak within ~7 s of the wake word; check the mic with `mic-check` |
| Gemini: `closed the connection: Request contains an invalid argument` right after you speak | Google rejected part of the set-up. Run `docker compose run --rm max node dist/tools/gemini-check.js`: it tests each part (voice options, each action) against Gemini and names what's rejected. Leave a rejected action out with `REALTIME_EXCLUDE_TOOLS=<name>` in `.env` |
| Max cuts himself off / answers himself | Turn `REALTIME_BARGE_IN` off, or use headphones |
