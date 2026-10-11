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

> **The official openWakeWord notebook no longer works on Colab** (it fails with
> `No module named 'piper_phonemize'` / `torchvision==0.20.0` errors, because Colab moved to
> a newer Python). Use the community-maintained notebook below instead: it's patched for
> current Colab and exports the **`.tflite`** file Max needs. It's a third-party project, so
> if it breaks in future, check its GitHub page for updates.

1. Open the notebook:
   **https://colab.research.google.com/github/amandamarielux/openwakeword_update_sept_2026/blob/main/wakeword_trainer_HA.ipynb**
   (project page: https://github.com/amandamarielux/openwakeword_update_sept_2026)
2. In Colab: **Runtime → Change runtime type → T4 GPU** (free tier is fine).
3. Find the configuration cell (it contains `TARGET_PHRASE`) and set:
   ```python
   TARGET_PHRASE = ['hey max']
   MODEL_NAME    = 'hey_max'
   ```
   `MODEL_NAME` must be exactly `hey_max`: it becomes the file name and the wake word name.
4. **Runtime → Run all**, then leave the tab open and your computer awake. It takes
   about 75–90 minutes on the free T4 (it downloads ~25 GB of training data inside Colab,
   not to your computer).
5. The last cell downloads **`hey_max.tflite`** (and a `.onnx` you don't need).

If the free runtime disconnects part-way, reconnect and **Run all** again: the notebook
skips the steps it already finished.

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
