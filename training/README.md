# Training the "Hey Max" wake word

Max listens with **openWakeWord**, which runs on your Ubuntu machine. No audio leaves the
house until the wake word is heard. "Hey Max" isn't a built-in phrase, so we train a small
custom model once. After that it costs nothing to run.

**How it works:** you don't record hundreds of clips yourself. The trainer generates
thousands of synthetic "hey max" voices (different accents, speeds and pitches), mixes them
with background noise, and teaches a small model to tell them apart from everyday speech
and TV.

**Effort:** about 1 hour, mostly waiting. **Cost:** free.

---

## Option A: Google Colab (recommended, no setup)

1. Open the official openWakeWord training notebook:
   **https://colab.research.google.com/drive/1q1oe2zOyZp7UsB3jJiQ1IFn8z5YfjwEb**
2. In Colab: **Runtime → Change runtime type → T4 GPU** (free tier is fine).
3. Set the target phrase to **`hey max`**.
4. **Check the pronunciation first.** The notebook plays a sample of the phrase. If it
   doesn't sound like "hey Max", try phonetic spellings such as `hey maks` or `hay max`
   until it does. This matters more than any other setting.
5. Training settings. Start with the defaults. If you have time, raise the number of
   examples and training steps for a more reliable model. Raise the false-activation
   penalty if your test run wakes up on its own.
6. **Runtime → Run all**, then wait (about 45–60 minutes).
7. Download the **`.tflite`** file it produces and rename it to **`hey_max.tflite`**.

## Option B: Train on your own Ubuntu machine (more control, needs an NVIDIA GPU)

Use the detailed notebook
[`notebooks/automatic_model_training.ipynb`](https://github.com/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb)
from the openWakeWord repository. It runs the same process with every setting exposed:
more examples, longer training, and your own background-noise recordings from the room
Max will live in. Plan for roughly 20–30 GB of free disk space for the training datasets.

---

## Install the model

```bash
cp ~/Downloads/hey_max.tflite wakewords/
docker compose restart openwakeword
```
In `.env`, make sure you have `WAKEWORD_NAMES=hey_max`.

## Test and tune (10 minutes, worth doing)

```bash
npm run mic-check
```
This shows live microphone levels and prints every detection.

| Test | Good result | If not |
|---|---|---|
| Say "hey Max" 10× at normal volume from where you usually sit | 9–10 detections | Lower `--threshold` in `docker-compose.yml` (e.g. 0.4), or retrain with more examples |
| Talk normally / play TV for 10 minutes | 0 detections | Raise `--threshold` (e.g. 0.6–0.7), or set `--trigger-level 2` |
| Say "Max" alone, or a similar name | Ideally 0 | Expected sometimes with a short phrase; raise the threshold |

After any change: `docker compose restart openwakeword`.

The same screen helps set **`VAD_RMS_THRESHOLD`** in `.env` (how Max knows you've
stopped talking). Pick a value roughly midway between the "quiet room" level and your
normal speaking level.

**About the phrase:** "Hey Max" is short, and "Max" is a common word and name, so it is
more prone to accidental wake-ups than a longer phrase. Tuning the threshold usually
solves it. If it doesn't, "Hey Max, …" can be trained alongside a longer variant such as
"Okay Max", and you can keep whichever performs better.

**Until the model is trained:** set `WAKEWORD_NAMES=hey_jarvis`. That phrase is built in,
so you can use everything else straight away.
