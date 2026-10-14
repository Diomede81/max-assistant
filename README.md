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
- **You can see what he's doing:** while he checks email, the calendar, the web or the house, his face
  shows it ("📧 Checking your email..."); if it takes more than a second he says so; and if an action
  fails, the face shows "Couldn't finish" with what it was.
- **Stopping him:** say **"stop"**, "that's all", "never mind" or "I'm not talking to you" and he goes quiet
  and back to sleep at once. While he's talking, **"Hey Max"** cuts him off (then "stop", or a new
  question). If he hears people talking to each other during a follow-up, he ends the conversation
  quietly instead of answering.
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

- **Knows where home is**: set your town (and optionally postcode) on the control panel; local questions and
  web searches use it.
- **Search the web and read pages** with Firecrawl, built in: add `FIRECRAWL_API_KEY` to `.env`. See **[docs/APPS.md](docs/APPS.md#web-search-and-reading-pages-firecrawl-built-in)**.
- **Email, calendar and other apps** (Office 365, and more) via Composio: connect them from the control
  panel at http://localhost:8099. Sending, deleting and similar actions always need your spoken "yes".
  See **[docs/APPS.md](docs/APPS.md)**.

- **His own identity**: a "soul" you write (his story, personality, how he talks; he starts as an
  easy-going friend) plus a journal of what he learns about himself living with you. Edit both on the
  control panel. See **[docs/SOUL.md](docs/SOUL.md)**.

- **Memory**: Max remembers people, preferences, routines, dates and work projects, filed in three
  encrypted vaults (Personal, Household, Work). Work memory is locked outside your work hours, guest mode
  hides personal details, and he searches by meaning, so knowledge scales without slowing him down.
  "Remember that…", "What do you know about…", "Forget…", "Work mode". See **[docs/MEMORY.md](docs/MEMORY.md)**.

- **Projects**: people, tasks with due dates and spoken reminders, and a dedicated memory per project.
  "Create a work project called Milan launch with Marco and Anna", "Add a task to Milan: send the budget
  by Wednesday", "What's due this week?". See **[docs/MEMORY.md](docs/MEMORY.md#projects)**.

- **My Day**: one to-do list where every item has a priority (high, medium, low: how soon) and a
  criticality (critical, important, routine: what's at stake), optionally tied to a project.
  "Add to my to-do list: renew the car insurance, high priority, critical", "Move the insurance to the
  Home admin project", "What's going on in my day?": Max runs through today's calendar events (when a
  calendar app is connected), reminders and to-dos, and calls out what's critical or overdue. Also on the
  control panel's My Day tab.

- **Routines: your news briefing**: give Max a list of websites and your interests; every morning he
  gathers the news, picks the 5–6 articles that suit you and prepares a short summary of each, ready when
  you ask "What's the news?". He can also suggest websites for your interests and find their news feeds.
  See **[docs/ROUTINES.md](docs/ROUTINES.md)**.

- **Bring your own AI model**: add keys for OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek,
  Mistral, a local Ollama or any compatible service, then choose which model does each background job
  (news, suggestions, memory) on the control panel. See **[docs/MODELS.md](docs/MODELS.md)**.

Set `TZ` in `.env` (e.g. `TZ=Europe/London`) so the time is right inside Docker.

## Real-time voice (demo mode)

Set `VOICE_MODE=realtime` to talk to Max through OpenAI's speech-to-speech model: the most natural
conversation, typically under a second to respond, paid per minute. See **[docs/REALTIME.md](docs/REALTIME.md)**.

## Voice

The default voice (Piper) is fast but robotic. For a natural voice, switch to **Kokoro**
(free, runs locally) or **OpenAI voices** (paid, most expressive). See **[docs/VOICES.md](docs/VOICES.md)**.

## Music

The Max box can be a Spotify speaker: "Hey Max, play my running playlist", "skip", "louder". It also
appears as **Max** in the Spotify app on any phone, and the music turns down while Max talks (needs
Spotify Premium). See **[docs/MUSIC.md](docs/MUSIC.md)**.

## The Max box

A Raspberry Pi 5 with a round screen showing Max's animated face, a 4-microphone array with echo
cancellation, and a proper speaker, in a 3D-printed case. If it ever loses WiFi, it shows a QR code to
set it up from your phone. See **[docs/PI.md](docs/PI.md)** for the setup (and `hardware/enclosure/`
for the case, once added).

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
