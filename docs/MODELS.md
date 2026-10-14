# AI models: bring your own

Max uses an AI model in two kinds of places:

- **The conversation**: what he says back to you. This uses the `LLM_*` settings in `.env`. Speed matters
  most here, so it stays on one fast model you choose there.
- **Background jobs**: work he does on his own. Each job can use a different model from a different
  provider, chosen on the control panel (**Settings → AI models**):

| Job | What it does | What it needs |
| --- | --- | --- |
| News briefings | Picks the articles that match your interests and writes the summaries | Good writing; runs once a day |
| Website suggestions | Suggests news websites for your interests | Broad knowledge of the web; runs rarely |
| Filing conversations | After each conversation, decides what to remember and where | Reliable and cheap; runs often |
| Memory tidy-up | Rolls old notes into weekly and monthly digests | Cheap; runs in the background |

By default every job uses the main model. Typically you'd pick a stronger model for website suggestions
and news summaries, and keep a cheap fast one for filing.

## Setting up a provider

Add its key to `.env` and restart Max. Keys only go in `.env`, never on the control panel.

| Provider | Setting | Notes |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | |
| Google Gemini | `GEMINI_API_KEY` | The same key as Gemini Live voice |
| OpenRouter | `OPENROUTER_API_KEY` | Hundreds of models from many companies with one key |
| Groq | `GROQ_API_KEY` | Very fast open models |
| DeepSeek | `DEEPSEEK_API_KEY` | |
| Mistral | `MISTRAL_API_KEY` | |
| Ollama | `OLLAMA_BASE_URL` | Models running on your own computer, e.g. `http://192.168.1.20:11434/v1`. Free and private |
| Anything else | `CUSTOM_LLM_BASE_URL` (+ `CUSTOM_LLM_API_KEY`) | Any OpenAI-compatible service |

Then on the control panel, for each job: pick the provider, pick the model (the list comes live from the
provider, so it's always current; you can also type a name) and press **Save**. **Test** sends a tiny
request and shows how long the model took to answer.

## If something goes wrong

If a chosen model fails (a typo in its name, an expired key, the provider is down), Max does that run
with the main model instead and notes it in the log. Your briefing still arrives and your memory is
still filed. Press **Test** on the control panel to see the error.

The choices are kept in `data/models.json` (no keys in it).
