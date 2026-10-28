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
- **Stopping him:** say **"stop"**, "that's all", **"thank you"** (on its own or in a sentence), "never mind"
  or "I'm not talking to you" and he goes quiet and back to sleep at once. A request after the thanks still
  goes through ("thanks, can you also set a timer"). While he's talking, **"Hey Max"** cuts him off (then "stop", or a new
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
#    Until then, tick "Hey Jarvis" (built in) in Settings → Voice & wake word → Wake words on the control panel.
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
- **Health**: a Health area for exercise, diet, heart, sleep and weight ("I ran 5 km in 30 minutes", "my blood
  pressure is 128 over 82"), with goals and trends; exercise routines and meal plans made from websites you
  choose, daily or weekly, sent to you by email or WhatsApp. See [docs/HEALTH.md](docs/HEALTH.md).
- **WhatsApp**: "Any new WhatsApp messages?", "what did Magda say?", "message Magda that I'm on my way"
  (only to people you allow on the control panel, and after your "yes"). Links like WhatsApp Web. See
  [docs/WHATSAPP.md](docs/WHATSAPP.md).
- **Trains (UK)**: "When's the next train to Waterloo?" (live times, delays, platforms) and "get me to Manchester
  by 10 tomorrow" (journeys with changes, plus a QR code on the screen to book on Trainline). See
  **[docs/TRAINS.md](docs/TRAINS.md)**.
- **Meeting notes**: send Max to your Teams, Zoom or Google Meet meetings as a notetaker and get the transcript
  of who said what (via Recall.ai). See **[docs/MEETINGS.md](docs/MEETINGS.md)**.
- **Recipes and how-tos on the screen**: "Show me a recipe for macaroni cheese" puts the ingredients and
  then each step on the screen; say "next step" or tap **Next**.
- **Timers and reminders**: "Set a pasta timer for 10 minutes", "Remind me in 20 minutes to call Mum",
  "How long is left?", "Cancel the pasta timer". Max chimes and announces them out loud when they
  finish (no wake word needed). Timers are kept in memory, so they don't survive a restart.

- **Knows where home is**: set your town (and optionally postcode) on the control panel; local questions and
  web searches use it.
- **Search the web and read pages** with Firecrawl, built in: add `FIRECRAWL_API_KEY` to `.env`. See **[docs/APPS.md](docs/APPS.md#web-search-and-reading-pages-firecrawl-built-in)**.
- **Email, calendar and other apps** (Gmail, Outlook / Office 365, and more) via Composio: connect them from the
  control panel at http://localhost:8099 (on the box: http://max.local:8099). Ask "show me my last email"
  and it appears on the screen with a short summary.
- **Your "yes" first** for anything that matters: sending, deleting or accepting in your apps, turning the box off,
  installing an update, "forget everything", and Home Assistant locks, doors, the garage, gates and the alarm. Max
  checks that *you* answered yes after he asked; a "yes" written in an email or a web page doesn't count. In guest
  mode, locks, doors, the garage, the alarm and updates can't be controlled by voice at all.
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

- **People**: the people close to you, by circle (family, close friends, friends…): when you last spoke,
  texted or met (by voice, on the dashboard, or from WhatsApp), what they're into, how they're doing, and a
  nudge when it's been too long. See **[docs/PEOPLE.md](docs/PEOPLE.md)**.
- **Journal**: tell Max what you did during the day; he adds the meetings he attended and your calendar
  events, and writes a weekly and monthly review of your life (what you did, people, health, work, how it
  felt, patterns). See **[docs/JOURNAL.md](docs/JOURNAL.md)**.
- **Scheduled tasks**: anything Max can do, done on his own at a set time (once, on chosen days or
  monthly), with the effort and the AI model you choose: check trains, compare prices, research something,
  read the news on a topic. The result is spoken, kept on the control panel, emailed or sent on WhatsApp.
  See **[docs/ROUTINES.md](docs/ROUTINES.md)**.
- **Bring your own AI model**: add keys for OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek,
  Mistral, a local Ollama or any compatible service, then choose which model does each background job
  (news, suggestions, memory) on the control panel. See **[docs/MODELS.md](docs/MODELS.md)**.

Set `TZ` in `.env` (e.g. `TZ=Europe/London`) so the time is right inside Docker.

## Real-time voice

Set `VOICE_MODE=realtime` to talk to Max through a speech-to-speech model: the most natural conversation,
typically under a second to respond, paid per minute. Two providers: **OpenAI Realtime** or **Gemini Live**
(similar speed, roughly 10x cheaper). His voice can be chosen and tried out on the control panel
(**Settings → Voice & wake word**), and his "Hey Max" greeting is spoken in that same voice.
See **[docs/REALTIME.md](docs/REALTIME.md)**.

## Voice (normal mode)

The default voice (Piper) is fast but robotic. For a natural voice, switch to **Kokoro**
(free, runs locally) or **OpenAI voices** (paid, most expressive). See **[docs/VOICES.md](docs/VOICES.md)**.

## Music

Three ways to play music through Max, one at a time; the music always turns down while he talks:

- **Spotify:** "Hey Max, play my running playlist", "skip", "louder". The box also appears as **Max** in
  the Spotify app on any phone (needs Spotify Premium).
- **Internet radio** (free, no account): "Hey Max, play BBC Radio 2", "play some jazz radio", "play the radio"
  (the last station). Thousands of stations from the radio-browser.info directory.
- **AirPlay:** on an iPhone, iPad or Mac, pick **Max** as the speaker in any app (Apple Music, YouTube Music,
  podcasts...). Protected by a 4-digit code shown on the control panel; off while Max is locked.

The screen shows what's playing with the album cover (Spotify and AirPlay) or the station's logo (radio).
See **[docs/MUSIC.md](docs/MUSIC.md)**.

## The Max box

A Raspberry Pi 5 with a round 720×720 touch screen, a ReSpeaker XVF3800 4-microphone board (with echo
cancellation, so "Hey Max" works while he talks or plays music) and a speaker, in a 3D-printed case
(`hardware/enclosure/`). Setup: **[docs/PI.md](docs/PI.md)**.

- **His face:** a 3D robot whose eyes and mouth show his expressions and move with his voice. Pick another
  character on the control panel (an astro droid, a golden droid, a rolling droid or a blue alien) or the
  classic flat face. It dims after 10 seconds of quiet and lights up for "Hey Max", a card or a touch.
- **Cards on the screen:** timers and reminders, what's playing, recipes step by step, your emails with a
  short summary, the news headlines, and "Your day" (meetings, reminders, to-dos with a **Done** button).
  When the conversation ends, the screen goes back to his face (timers, reminders and recipes stay until you
  close them).
- **Notifications:** news briefing ready, an important email, an overdue to-do; never while you're talking,
  at night or in guest mode. Optional **captions** show what he heard and what he's saying.
- **Glance and photo frame:** weather, next meeting and to-dos around his face while idle; your own pictures
  in the evening.
- **Dances to the music:** while music plays (Spotify, radio or AirPlay) his face moves to the beat:
  bouncing to dance and pop, headbanging to rock, swaying to jazz and classical, nodding to the rest.
- **Start-up code:** an optional 6-digit code to type on the screen each time the box starts. Until then
  Max won't answer, act or show anything personal, and AirPlay is off.
- **Greeting and jingle:** "Hey Max" is answered with "Hello, how can I help?" (your choice of words, or
  a beep), and a short jingle plays when he's ready after a start or an update.
- **Speaker sound:** Flat, Warm (fuller, for music) or Voice (clearer speech), chosen on the control panel.
- **Updates from GitHub:** from the screen's menu, the control panel or by voice ("Max, update yourself").
- **Easy to run:** a menu on the screen (hold for 2 seconds) for volume, brightness, WiFi setup, lock,
  update, restart and turn off. If it loses WiFi, it shows a QR code to set it up from your phone.

## Project layout

| Module | Responsibility |
|---|---|
| `audio/` | Microphone capture (`arecord`), playback (`aplay`), end-of-speech detection |
| `wyoming/` | Client for Home Assistant's Wyoming voice protocol |
| `wake-word/` | openWakeWord with the custom "hey max" model ([training guide](training/README.md)) |
| `stt/` | Speech-to-text (Whisper via Wyoming) |
| `llm/` | Any OpenAI-compatible LLM, streaming + tool calls + fallback |
| `tts/` | Text-to-speech (Piper, Kokoro or OpenAI voices), sentence-by-sentence pipelining, chimes and jingle |
| `realtime/` | Real-time voice (OpenAI Realtime, Gemini Live) and the recorded live-voice phrases |
| `conversation/` | The flow: wake → listen → think/act → speak → follow-up, and the stop phrases |
| `actions/` | Built-in actions (time, timers, reminders, screen cards, power, volume) and the action router |
| `ha-mcp/`, `mcp/`, `composio/` | Home Assistant, other MCP servers, and apps (email, calendar...) via Composio |
| `web/`, `weather/`, `location/` | Web search and reading (Firecrawl), weather (Open-Meteo), home location |
| `memory/`, `soul/`, `routines/`, `models/` | Encrypted memory and projects, Max's identity, news briefings, bring-your-own AI models |
| `music/` | Spotify (go-librespot), internet radio, AirPlay, turning music down while Max talks |
| `face/` | The screen: 3D and classic face, cards, notifications, glance, photo frame |
| `device/`, `lock/`, `updates/` | Volume, brightness, speaker sound and greeting; the start-up code; updates from GitHub |
| `control-panel/` | The web control panel (port 8099) |
| `tools/` | `npm run mic-check` (mic levels and wake word) · `npm run chat` (type to Max) · wake word coach · Gemini check |
| `scripts/pi/` | The Max box setup and its services (screen, sound, AirPlay, WiFi, power, updates) |

## Roadmap

- [x] Interrupting Max while he speaks ("Hey Max", then "stop" or a new question)
- [x] Speech-to-speech mode (OpenAI Realtime / Gemini Live) for the lowest latency
- [ ] Interrupting just by starting to talk, without the wake word
- [ ] Silero VAD for noisy rooms
- [ ] Cloud streaming STT/TTS providers (Deepgram, ElevenLabs Flash, Cartesia)
- [ ] Native Anthropic (Claude) provider for the conversation (background jobs can already use it)
- [ ] Multiple rooms via ESP32 satellites
