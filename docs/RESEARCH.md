# Technology research: low-latency voice assistant for Home Assistant

*Web check: October 2026. Prices and model names change monthly, and many published
benchmarks are vendor-run and disagree, so measure on your own setup (Max logs
per-turn latency for exactly this reason).*

## 1. Language: TypeScript / NestJS is a sound choice

| Area | Fit in Node/TypeScript |
|---|---|
| Home Assistant MCP | Excellent: the official MCP SDK is TypeScript-first |
| LLM providers | Excellent: every provider has a Node SDK or an OpenAI-compatible API |
| Wake word / STT / TTS | Use Home Assistant's **Wyoming** services (run in Docker) and talk to them from Node over TCP. No Python code to maintain. |

**Decision:** NestJS for the "brain", ready-made Wyoming containers for audio.

## 2. Target response time

| Step | Typical |
|---|---|
| End-of-speech detection | 300–500 ms (largest hidden delay; tunable) |
| Speech-to-text | ~150–300 ms |
| LLM first token | ~70–500 ms cloud; 0.2–2 s local (GPU dependent) |
| Home Assistant tool call | 50–200 ms on the LAN |
| Text-to-speech first audio | ~100–450 ms |
| **Target total** | **≈ 1–1.5 s** from end of speech to first word |

## 3. LLM options

### Cloud (best speed today)

| Provider | First-token latency (reported) | Notes |
|---|---|---|
| **Groq** | ~80–200 ms in most reports; 0.69 s for gpt-oss-120b in one Aug 2026 voice benchmark | Very cheap, OpenAI-compatible. **Default in this repo.** |
| **Cerebras** | ~70–100 ms warm; 0.49 s for gpt-oss-120b in the same benchmark | Highest throughput, OpenAI-compatible |
| **Gemini Flash** | ~280–450 ms in benchmarks; one voice team measured ~2 s on a preview model | Strong tool use, cheap; latency varies by region |
| **Claude Haiku** | Anthropic's fast tier | Reliable instruction following and tool use (native adapter on roadmap) |
| **Speech-to-speech** (OpenAI Realtime, Gemini Live) | ~0.25–1.1 s voice-to-voice reported | Most natural feel; OpenAI's model supports MCP natively. Costs more (OpenAI estimated at ~$0.15–0.20/min); Gemini Live audio is much cheaper per token |

### Local (private, no running cost)

| Model | Size | Notes |
|---|---|---|
| **Qwen3 8B** | ~5 GB | Community consensus best small model for Home Assistant tool calling. Needs a GPU (12 GB+ recommended) |
| **Qwen3 4B** | ~2.5 GB | For CPU-only or modest GPUs |
| Qwen3 30B-A3B | 24 GB GPU | Top pick for 24 GB cards; some parsing errors reported, so test first |
| Gemma 3 4B, Phi-4-mini, GPT-OSS 20B | — | Proven Home Assistant tool-calling support |

Tips from the community: choose models with Ollama's **"tools" capability**, avoid "thinking"
modes for voice, and **expose fewer entities** (30 entities ≈ 1,300 tokens of context).

## 4. Voice components

| Component | Choice | Why |
|---|---|---|
| Wake word | **openWakeWord** (local, free, custom "hey max" model, see training/README.md) | ⚠️ Picovoice Porcupine's **free tier keys stopped working after 30 June 2026** (per Home Assistant community reports), so it now needs a paid licence |
| Speech-to-text | **Whisper** (local) → **Deepgram** (cloud) for speed | Deepgram pairs STT + TTS, cutting a hop |
| Text-to-speech | **Piper** (local, fast) | Cloud upgrades below |

Cloud TTS (independent Sept 2026 test, median time to first audio): **ElevenLabs Flash v2.5 ~185 ms**
(most consistent, ~$50 / 1M chars), Deepgram Aura-2 ~200–310 ms (~$30 / 1M chars),
Cartesia Sonic: ~40 ms advertised vs 188–440 ms measured. **Kokoro** is open-source and
high quality, mostly English.

## 5. Home Assistant MCP (verified against the official docs)

- Built-in integration **"Model Context Protocol Server"**, endpoint **`/api/mcp`**.
- Supports **Streamable HTTP** with a **long-lived access token** (`Authorization: Bearer …`)
  or OAuth 2.0 with PKCE.
- Only entities **exposed to Assist** are visible; control can be disabled entirely.

## 6. Recommended setup

1. **Local:** wake word, end-of-speech detection, Piper voice. Private, and no audio leaves the house until the wake word fires.
2. **Cloud:** Groq or Cerebras LLM, for the best responsiveness at a cost of pennies per day.
3. **Local Ollama + Qwen3** as the automatic fallback for when the internet is down.
4. **Upgrade path:** Deepgram STT, ElevenLabs Flash TTS, or a speech-to-speech model.

## Sources

- [Home Assistant: Model Context Protocol Server](https://www.home-assistant.io/integrations/mcp_server)
- [MarkTechPost: TTFT benchmark for voice agents (Aug 2026)](https://www.marktechpost.com/2026/08/30/lowest-latency-inference-apis-for-voice-and-realtime-agents-a-time-to-first-token-ttft-first-benchmark/)
- [Google AI forum: Gemini Flash vs Groq TTFT](https://discuss.ai.google.dev/t/high-ttft-2s-with-gemini-flash-vs-150ms-on-groq-any-optimization-or-throttling-insights/138024)
- [Eden AI: LLM API latency 2026](https://www.edenai.co/post/llm-api-latency-benchmarks-speed-comparison-across-providers)
- [Groq vs Cerebras 2026](https://verticalapi.com/vs/groq-vs-cerebras/)
- [Digital Applied: latency benchmarks 2026](https://www.digitalapplied.com/blog/ai-model-latency-benchmarks-2026-ttft-throughput)
- [Botmonster: Home Assistant with a local LLM in 2026](https://botmonster.com/smart-home/build-private-local-ai-voice-assistant-2026/)
- [PromptQuorum: Best local LLMs for Home Assistant](https://www.promptquorum.com/smart-home/best-local-llm-models-smart-home)
- [Best local LLM for smart home](https://bestllmfor.com/guides/best-local-llm-smart-home-privacy/)
- [HA community: Picovoice free tier ends 30 June 2026](https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744)
- [Coval: Best TTS providers 2026](https://www.coval.ai/blog/best-text-to-speech-providers-in-2026-how-to-choose-(and-why-vendor-benchmarks-lie)/)
- [Future AGI: TTS APIs compared](https://futureagi.com/blog/best-text-to-speech-providers-2026/)
- [Forasoft: streaming TTS compared](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/streaming-tts-kokoro-elevenlabs-turbo-openai-tts)
- [Forasoft: OpenAI Realtime API production guide](https://www.forasoft.com/blog/article/openai-realtime-api-voice-agent-production-guide-2026)
- [Anthemcreation: GPT-Realtime-2](https://anthemcreation.com/intelligence-artificielle/gpt-realtime-2-ga-128k-reasoning-effort/)
- [Wyoming protocol](https://github.com/OHF-Voice/wyoming)
