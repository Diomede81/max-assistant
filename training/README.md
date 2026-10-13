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

> **Known bug in that notebook's last step (fix before downloading):** its `.tflite` conversion
> (`onnx2tf`) swaps the model's input from `[1, 16, 96]` to `[1, 96, 16]`. The wake word
> service then waits for ~8 s of continuous speech before checking, so the model **never
> triggers**. Before running section 15, replace its line
> `!onnx2tf -i "{out_path}" -o "{tf_dir}"` with:
> ```python
> import onnx
> m = onnx.load(out_path); old = m.graph.input[0].name
> for n in m.graph.node: n.input[:] = ['x' if i == old else i for i in n.input]
> m.graph.input[0].name = 'x'; onnx.save(m, out_path)
> get_ipython().system(f'onnx2tf -i "{out_path}" -o "{tf_dir}" -kat x')
> ```
> Already downloaded a broken `.tflite`? Keep the `.onnx` it also downloaded and convert that
> again the same way (or ask for help: it takes a minute and no retraining).
>
> **Check any model** (run in the `max-assistant` folder; the input must be `[1, 16, 96]`):
> ```bash
> docker compose exec openwakeword sh -c '$(ls /app/.venv/bin/python3 2>/dev/null || echo python3) -c "from pyopen_wakeword import OpenWakeWord as W; m=W.from_model(\"/custom/hey_max.tflite\"); L,t=m.lib,m.input_tensor; print([L.TfLiteTensorDim(t,i) for i in range(L.TfLiteTensorNumDims(t))])"'
> ```

## Option B: Train on your own Ubuntu machine (more control, needs an NVIDIA GPU)

Use the detailed notebook
[`notebooks/automatic_model_training.ipynb`](https://github.com/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb)
from the openWakeWord repository. It runs the same process with every setting exposed:
more examples, longer training, and your own background-noise recordings from the room
Max will live in. Plan for roughly 20–30 GB of free disk space for the training datasets.

---

## Waking up by itself

Three layers stop false wake-ups (noise, music, TV), from cheapest to strongest:

1. **The double-check (on by default).** When the wake word engine fires, Max runs the last 2.5 seconds
   through his own on-device speech recogniser. If nothing in it sounds like the wake word, he stays
   asleep: no chime, no face change. It's lenient with mishearings ("Marx", "Mats", "Mex" all count),
   and **saying it again within 10 seconds always wakes him**. The log shows
   `Ignored a possible false wake-up: heard "…"`. It adds a fraction of a second before the chime.
   `WAKEWORD_VERIFY=off` disables it.
2. **`WAKEWORD_TRIGGER_LEVEL=2`** in `.env`: the engine must hear the wake word for two moments in a row.
   Noise blips are ignored; a real "hey max" easily passes.
3. **A higher `WAKEWORD_THRESHOLD`** (e.g. 0.6–0.7).

Apply changes with `docker compose --profile max up -d`. The coach's background test shows which of
these you need.

**Now it's hard to wake him?** Undo the last two first: remove `WAKEWORD_TRIGGER_LEVEL` and set
`WAKEWORD_THRESHOLD` back to 0.5 (or lower; the double-check catches the extra false alarms). Then look
at the log for `Ignored a possible false wake-up` lines while you say the wake word: if they show your
real attempts, send them over (or set `WAKEWORD_VERIFY=off`).

## Training with your own voice (recommended if the coach scores you near 0)

The model above learns only from computer-generated voices. If your voice or accent isn't
like them, it may barely react to you. Adding your own recordings fixes that, and a few
settings make the model stronger overall. Same Colab notebook, same ~90 minutes (a bit more
with the larger settings).

1. **Record yourself:** run `./scripts/wake-coach.sh` 3 or 4 times, in different rooms and at
   different distances (and once per person in the house, if others will use Max). That gives
   30–40 recordings in the `wake-coach` folder.
2. **In the configuration cell** (the one with `TARGET_PHRASE`), use:
   ```python
   TARGET_PHRASE = ['hey max', 'hey maks', 'hey macks']   # spellings that sound like "max" in different accents
   MODEL_NAME    = 'hey_max'
   ```
   and in the settings below it change:
   ```python
   'custom_negative_phrases': ['max', 'hey mike', 'hey mac', 'hey man', 'taxi', 'relax'],
   'n_samples':       10000,   # was 2000: more voices to learn from
   'n_samples_val':   2000,
   'steps':           40000,   # was 20000
   ```
3. **Upload your recordings:** in Colab's Files panel (folder icon on the left), create a folder
   `my_voice` and drag in all the `positive_*.wav` and `negative_*.wav` files from your
   `wake-coach` folders (they can share the folder: rename duplicates if asked).
4. **Add a cell** just *before* the "Augment + featurise" section (click there, then **+ Code**)
   with:
   ```python
   import glob, shutil, yaml
   import numpy as np, soundfile as sf
   cfg = yaml.safe_load(open('/content/my_model.yaml'))
   mine_pos = sorted(glob.glob('/content/my_voice/positive_*.wav'))
   mine_neg = sorted(glob.glob('/content/my_voice/negative_*.wav'))

   def trimmed(f):  # cut the silence around the phrase, like the generated examples
       a, sr = sf.read(f, dtype='int16')
       loud = np.where(np.abs(a.astype(float)) > max(300, np.abs(a).max() * 0.1))[0]
       return (a[max(0, loud[0] - sr // 5): loud[-1] + sr // 5] if len(loud) else a), sr

   # Each recording is reused many times; the next step mixes in different noise and rooms.
   for i, f in enumerate(mine_pos):
       a, sr = trimmed(f)
       for k in range(40):
           sf.write(f"{cfg['positive_clips_train_dir']}/my_voice_{i:03d}_{k:02d}.wav", a, sr)
   for i, f in enumerate(mine_neg):
       for k in range(10):
           shutil.copy(f, f"{cfg['negative_clips_train_dir']}/my_voice_{i:03d}_{k:02d}.wav")
   print(f'Added {len(mine_pos)} wake word and {len(mine_neg)} normal-speech recordings of you')
   ```
5. **Runtime → Run all**, and apply the `.tflite` fix from Option A before the last step.
6. Install it as below, then run the coach again: you should see much higher scores.

## Install the model

```bash
cp ~/Downloads/hey_max.tflite wakewords/
docker compose restart openwakeword
```
In `.env`, make sure you have `WAKEWORD_NAMES=hey_max`.

## Test and tune: the wake word coach (5 minutes)

```bash
./scripts/wake-coach.sh
```

It asks you to say the wake word 10 times (normally, quieter, faster, from further away), to read
three ordinary sentences, and records 45 seconds of your room's usual background sound (TV, music).
Then it scores every attempt with the same engine Max uses:

```
clip                level    score  at good level
positive_01         -9 dB     0.41           0.41   missed
positive_02        -11 dB     0.62           0.62   WAKES
...
Result: woke on 4 of 10 attempts.
 - The model does recognise you, just below the bar. Set WAKEWORD_THRESHOLD=0.35 in .env ...
```

**Score** is how sure the model is that it heard the wake word (0 to 1). Max wakes when it's
above `WAKEWORD_THRESHOLD` (default 0.5). The coach tells you which of these applies:

| What it finds | What it means | What to do |
|---|---|---|
| Most scores just under the bar | The model knows your voice, the bar is too high | Set the `WAKEWORD_THRESHOLD` it suggests in `.env`, then `docker compose up -d openwakeword` |
| Scores near 0 | The model doesn't recognise your voice: **no threshold will fix it** | Retrain with your own voice (below), or try a longer phrase |
| "Your microphone is quiet" | The sound reaching Max is too faint | Raise the input volume, or sit closer |
| A normal sentence or the background sound would have woken him | False wake-ups | It suggests `WAKEWORD_TRIGGER_LEVEL=2` and/or a higher `WAKEWORD_THRESHOLD`; keep `WAKEWORD_VERIFY` on |

Your recordings are kept in `wake-coach/<date>/` (not uploaded anywhere) for retraining.

You can also watch live detections and microphone levels with `npm run mic-check`.

The same screen helps set **`VAD_RMS_THRESHOLD`** in `.env` (how Max knows you've
stopped talking). Pick a value roughly midway between the "quiet room" level and your
normal speaking level.

**About the phrase:** "Hey Max" is short, and "Max" is a common word and name, so it is
more prone to accidental wake-ups than a longer phrase. Tuning the threshold usually
solves it. If it doesn't, "Hey Max, …" can be trained alongside a longer variant such as
"Okay Max", and you can keep whichever performs better.

**Until the model is trained:** set `WAKEWORD_NAMES=hey_jarvis`. That phrase is built in,
so you can use everything else straight away.
