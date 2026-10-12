# Max

**Max** is a private, low-latency voice assistant for **Home Assistant**, written in
**TypeScript / NestJS**. Say *"Hey Max"*, ask for something, and Max controls your home
through Home Assistant's built-in **MCP server**.

```
Mic → Wake word → End-of-speech → Speech-to-text → LLM ⇄ Home Assistant (MCP) → Text-to-speech → Speaker
       local         local           local*           cloud or local                local*
```
\* swappable for cloud services. See [docs/RESEARCH.md](docs/RESEARCH.md) for the options and trade-offs.

## Why it feels fast

- **Everything streams.** Audio goes to speech-to-text *while you talk*; Max starts speaking
  after the **first sentence** of the answer, not the whole answer.
- **Fast-first-token LLMs** (Groq / Cerebras by default), with a **local fallback**
  (Ollama + Qwen3) if the internet or the provider is slow.
- **Follow-up window:** after replying, Max listens for 5 seconds without needing the wake word.
- **Every turn logs a latency breakdown**, so you can tune with numbers.

## No Ubuntu machine yet? Use Docker

Run everything in containers on Mac, Windows or Linux, including a **typing mode** to test
Home Assistant control without any audio setup. See **[docs/DOCKER.md](docs/DOCKER.md)**.

## Quick start (Ubuntu)

```bash
# 1. System packages
sudo apt install -y alsa-utils docker.io docker-compose-v2 nodejs npm   # Node 20+

# 2. Local voice services: wake word, speech-to-text, text-to-speech
docker compose up -d

# 3. Home Assistant: Settings > Devices & services > Add integration >
#    "Model Context Protocol Server". Expose only the devices you want voice control over
#    (Settings > Voice assistants > Expose). Create a long-lived access token in your profile.

# 4. Configure
cp .env.example .env    # set HA_TOKEN, LLM_API_KEY (free Groq key: https://console.groq.com)

# 5. Wake word: train "hey max" once (about 1 hour, free) - see training/README.md
#    Until then, set WAKEWORD_NAMES=hey_jarvis in .env (built in) to try everything else.
npm install
npm run mic-check       # live mic levels + wake word detections, for tuning

# 6. Run
npm run dev
```

Say **"Hey Max… turn on the kitchen lights."**

### Optional: local LLM fallback (or fully offline)

```bash
docker compose --profile local-llm up -d
docker compose exec ollama ollama pull qwen3:8b     # qwen3:4b on CPU-only machines
```
Then set `LLM_FALLBACK_BASE_URL=http://127.0.0.1:11434/v1` and `LLM_FALLBACK_MODEL=qwen3:8b`
(or point the *primary* at Ollama to run with no cloud at all).

### Run on boot
See [`deploy/max.service`](deploy/max.service).

## What Max can do

- **Control your home** through Home Assistant: anything you expose to Assist (lights, heating, media, covers…)
- **Date and time**: "What's the date?", "What time is it?"
- **Timers and reminders**: "Set a pasta timer for 10 minutes", "Remind me in 20 minutes to call Mum",
  "How long is left?", "Cancel the pasta timer". Max chimes and announces them out loud when they
  finish (no wake word needed). Timers are kept in memory, so they don't survive a restart.

- **Email, calendar and other apps** (Office 365, and more) via Composio: connect them from the control
  panel at http://localhost:8099. Sending, deleting and similar actions always need your spoken "yes".
  See **[docs/APPS.md](docs/APPS.md)**.

- **Memory**: "Remember that Sofia's birthday is 14 March", "When is Sofia's birthday?", "Forget the
  boiler service". Max also writes a one-line note after each conversation and picks up lasting details
  you mention, so he knows today what you talked about yesterday. See and edit everything he knows on
  the control panel. See **[docs/MEMORY.md](docs/MEMORY.md)**.

Set `TZ` in `.env` (e.g. `TZ=Europe/London`) so the time is right inside Docker.

## Real-time voice (demo mode)

Set `VOICE_MODE=realtime` to talk to Max through OpenAI's speech-to-speech model: the most natural
conversation, typically under a second to respond, paid per minute. See **[docs/REALTIME.md](docs/REALTIME.md)**.

## Voice

The default voice (Piper) is fast but robotic. For a natural voice, switch to **Kokoro**
(free, runs locally) or **OpenAI voices** (paid, most expressive). See **[docs/VOICES.md](docs/VOICES.md)**.

## Project layout

| Module | Responsibility |
|---|---|
| `audio/` | Microphone capture (`arecord`), playback (`aplay`), end-of-speech detection |
| `wyoming/` | Client for Home Assistant's Wyoming voice protocol |
| `wake-word/` | openWakeWord with the custom "hey max" model ([training guide](training/README.md)) |
| `tools/` | `npm run mic-check`: live mic levels and wake word detections · `npm run chat`: type to Max instead of talking |
| `stt/` | Speech-to-text (Whisper via Wyoming) |
| `llm/` | Any OpenAI-compatible LLM, streaming + tool calls + fallback |
| `ha-mcp/` | Home Assistant MCP client (`/api/mcp`, Streamable HTTP) |
| `tts/` | Text-to-speech (Piper via Wyoming), sentence-by-sentence pipelining |
| `conversation/` | The flow: wake → listen → think/act → speak → follow-up |

## Roadmap

- [ ] Barge-in: say "stop" / interrupt Max while it is speaking (needs echo cancellation)
- [ ] Silero VAD for noisy rooms
- [ ] Cloud streaming STT/TTS providers (Deepgram, ElevenLabs Flash, Cartesia)
- [ ] Native Anthropic (Claude) provider alongside the OpenAI-compatible one
- [ ] Speech-to-speech mode (OpenAI Realtime / Gemini Live) for the lowest latency
- [ ] Multiple rooms via ESP32 satellites
