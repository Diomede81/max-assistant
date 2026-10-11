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

## Project layout

| Module | Responsibility |
|---|---|
| `audio/` | Microphone capture (`arecord`), playback (`aplay`), end-of-speech detection |
| `wyoming/` | Client for Home Assistant's Wyoming voice protocol |
| `wake-word/` | openWakeWord with the custom "hey max" model ([training guide](training/README.md)) |
| `tools/` | `npm run mic-check`: live mic levels and wake word detections for tuning |
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
