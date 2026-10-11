# Choosing Max's voice

| Option | Sound | Cost | Privacy | Setup |
|---|---|---|---|---|
| **Piper** (default) | Clear but robotic | Free | Fully local | Nothing |
| **Kokoro** (recommended) | Natural, expressive | Free | Fully local | 2 minutes |
| **OpenAI voices** | Most natural; follows tone instructions ("witty British butler") | Roughly 1–2 cents per minute of speech | Reply text goes to OpenAI | 2 minutes + API key |

Prices and voice lists change, so check the provider's current pages.

## Kokoro (local, free, natural)

1. In `.env`, set:
   ```
   TTS_PROVIDER=openai
   TTS_BASE_URL=http://kokoro:8880/v1
   TTS_MODEL=kokoro
   TTS_VOICE=bm_george
   ```
   (Use `http://127.0.0.1:8880/v1` if you run Max with `npm run dev` instead of Docker.)
2. Start Kokoro alongside everything else:
   ```bash
   docker compose --profile max --profile kokoro up -d
   ```
   The first start downloads the voice model (a few hundred MB). Wait until
   `docker compose logs kokoro` shows the server is ready.
3. Restart Max: `docker compose --profile max restart max`

**Voices to try** (`TTS_VOICE`):

| Voice | Style |
|---|---|
| `bm_george` | British male, warm (closest to a "Jarvis" feel) |
| `bm_lewis` | British male, deeper |
| `bm_daniel` | British male, lighter |
| `bm_fable` | British male, storyteller |
| `bf_emma`, `bf_isabella` | British female |
| `am_michael`, `am_adam` | American male |

Kokoro can also blend voices, e.g. `TTS_VOICE=bm_george+bm_lewis`. To hear them all, open
http://localhost:8880/web while Kokoro is running.

Kokoro runs on the computer's processor. It's quick on a modern Mac or a recent Intel/AMD
machine. On a very old or low-power machine, replies may start a little later than with Piper.

## OpenAI voices (cloud, most expressive)

1. In `.env`, set:
   ```
   TTS_PROVIDER=openai
   TTS_BASE_URL=https://api.openai.com/v1
   TTS_API_KEY=sk-...your OpenAI key...
   TTS_MODEL=gpt-4o-mini-tts
   TTS_VOICE=onyx
   TTS_INSTRUCTIONS=Speak like a calm, witty British butler. Warm, concise, slightly dry humour.
   ```
2. Restart Max: `docker compose --profile max up -d`

Voices to try: `onyx` (deep male), `ash`, `echo`, `fable`, `sage`, `coral`, `nova`.
`TTS_INSTRUCTIONS` changes the delivery (accent, mood, pace) without changing the words. Keep
it to one or two sentences.

## Back to Piper

Set `TTS_PROVIDER=piper` and restart Max. To try a different Piper voice, change `--voice`
in `docker-compose.yml` (samples: https://rhasspy.github.io/piper-samples/).

## If you hear nothing

`docker compose logs --tail 30 max` names the problem, e.g.
`Voice (text-to-speech) failed: speech API answered 401…` (wrong key) or
`no audio from the speech API within 15s` (Kokoro still starting, or wrong `TTS_BASE_URL`).
