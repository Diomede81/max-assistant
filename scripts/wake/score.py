"""Scores recorded wake word attempts with the exact engine Max uses (openWakeWord).

Runs inside the openwakeword container (it has the engine and the models); started by
scripts/wake-coach.sh. Prints, for every clip, the highest confidence the model gave it,
then a plain-English verdict: works, threshold too strict, microphone too quiet, or the
model doesn't recognise this voice (retrain with these clips).

    python3 score.py <clips dir> --names hey_max --threshold 0.5 --custom-dir /custom
"""

import argparse
import json
import sys
import wave
from pathlib import Path

import numpy as np
from pyopen_wakeword import Model, OpenWakeWord, OpenWakeWordFeatures

RATE = 16000
CHUNK = 1280  # 80 ms, what the live service receives per step
HEALTHY_PEAK = 0.5  # roughly -6 dBFS: a well-set microphone


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1 or w.getframerate() != RATE:
            raise ValueError(f"{path.name}: expected 16 kHz 16-bit mono")
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)


def load_model(name: str, custom_dir: Path) -> OpenWakeWord:
    custom = custom_dir / f"{name}.tflite"
    if custom.exists():
        return OpenWakeWord.from_model(custom)
    return OpenWakeWord.from_builtin(Model(name))


def best_score(audio: np.ndarray, model: OpenWakeWord, threshold: float = 0.5) -> tuple:
    """Highest confidence while streaming the clip, as the live service does, and the longest run of
    consecutive 80 ms steps above the threshold (what WAKEWORD_TRIGGER_LEVEL counts)."""
    features = OpenWakeWordFeatures.from_builtin()
    model.reset()
    # Silence either side: the engine needs ~1.5 s of context and the phrase may be at the edge.
    padded = np.concatenate([np.zeros(RATE, np.float32), audio, np.zeros(RATE // 2, np.float32)])
    pcm = np.clip(padded, -32768, 32767).astype(np.int16).tobytes()
    best, run, longest = 0.0, 0, 0
    for i in range(0, len(pcm), CHUNK * 2):
        for emb in features.process_streaming(pcm[i : i + CHUNK * 2]):
            for prob in model.process_streaming(emb):
                best = max(best, float(prob))
                run = run + 1 if prob > threshold else 0
                longest = max(longest, run)
    return best, longest


def peak(audio: np.ndarray) -> float:
    return float(np.max(np.abs(audio)) / 32768) if len(audio) else 0.0


def db(v: float) -> str:
    return f"{20 * np.log10(max(v, 1e-6)):.0f} dB"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("clips")
    ap.add_argument("--names", default="hey_max")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--custom-dir", default="/custom")
    ap.add_argument("--json", help="also write the results here")
    args = ap.parse_args()

    clips = Path(args.clips)
    pos = sorted(clips.glob("positive_*.wav"))
    neg = sorted(clips.glob("negative_*.wav"))
    if not pos:
        print(f"No recordings found in {clips}")
        return 1
    names = [n.strip() for n in args.names.split(",") if n.strip()]
    results = {}

    for name in names:
        try:
            model = load_model(name, Path(args.custom_dir))
        except Exception as e:  # noqa: BLE001
            print(f"Skipping {name}: {e}")
            continue
        phrase = name.replace("_", " ")
        print(f'\n=== "{phrase}" (wakes at {args.threshold:.2f}) ===')
        print(f"{'clip':<20}{'level':>9}{'score':>9}{'at good level':>15}")
        rows = []
        for path in pos + neg:
            audio = read_wav(path)
            p = peak(audio)
            s, run = best_score(audio, model, args.threshold)
            # The same clip at a healthy microphone level: shows whether volume is the issue.
            gain = HEALTHY_PEAK / p if p > 0 else 1.0
            sn = best_score(audio * gain, model)[0] if gain > 1.5 else s
            rows.append({"clip": path.stem, "positive": path in pos, "peak": p, "score": s, "scoreAtGoodLevel": sn, "run": run})
            mark = ("WAKES" if s > args.threshold else "missed") if path in pos else ("FALSE WAKE" if s > args.threshold else "ok")
            print(f"{path.stem:<20}{db(p):>9}{s:>9.2f}{sn:>15.2f}   {mark}")
        results[name] = rows
        verdict(rows, args.threshold, phrase)

    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=2))
    return 0


def verdict(rows: list, threshold: float, phrase: str) -> None:
    pos = [r for r in rows if r["positive"]]
    neg = [r for r in rows if not r["positive"]]
    scores = sorted(r["score"] for r in pos)
    boosted = sorted(r["scoreAtGoodLevel"] for r in pos)
    hits = sum(s > threshold for s in scores)
    worst_neg = max((r["score"] for r in neg), default=0.0)
    median_peak = float(np.median([r["peak"] for r in pos]))
    p20 = scores[max(0, int(len(scores) * 0.2) - 1)] if len(scores) >= 5 else scores[0]

    print(f"\nResult: woke on {hits} of {len(scores)} attempts.")
    tips = []
    if median_peak < 0.08:
        tips.append(
            f"Your microphone is quiet (typical peak {db(median_peak)}; healthy is about -12 to -3 dB). "
            "Raise the input volume (Mac: System Settings > Sound > Input; Max box: "
            "'wpctl set-volume @DEFAULT_SOURCE@ 1.0'), or sit closer."
        )
        if np.median(boosted) > threshold > np.median(scores):
            tips.append("At a healthy level most attempts WOULD wake him, so fixing the volume is the main fix.")
    if hits >= 0.9 * len(scores) and worst_neg <= threshold:
        tips.append(f'"{phrase}" works well here. If it misses at home, test again from where you usually sit.')
    elif p20 > worst_neg + 0.05 and p20 > 0.1:
        # Just under most of your attempts, but well clear of your normal speech (three sentences
        # can't prove it won't wake to the TV, so don't go lower than needed).
        suggested = round(max(0.2, worst_neg + 0.1, min(threshold, p20 * 0.85)), 2)
        if suggested < threshold:
            tips.append(
                f"The model does recognise you, just below the bar. Set WAKEWORD_THRESHOLD={suggested} in .env "
                f"(your normal sentences scored at most {worst_neg:.2f}, so that stays safe), then run "
                "'docker compose up -d openwakeword'."
            )
    if np.median(scores) < 0.1 and np.median(boosted) < 0.1:
        tips.append(
            "The model barely recognises your voice saying it: no threshold will fix that. Retrain it with these "
            "recordings added (see training/README.md, 'Training with your own voice'), or try a longer phrase."
        )
    if worst_neg > threshold:
        false_runs = [r["run"] for r in neg if r["score"] > threshold]
        pos_runs = [r["run"] for r in pos if r["score"] > threshold]
        raise_to = round(min(0.95, worst_neg + 0.05), 2)
        keeps = sum(s > raise_to for s in scores)
        tips.append("Something other than the wake word would have woken him (false wake-ups). Fixes, best first:")
        if false_runs and max(false_runs) <= 1 and pos_runs and np.median(pos_runs) >= 2:
            tips.append(
                "   • Set WAKEWORD_TRIGGER_LEVEL=2 in .env: the false alarms were single blips, while your real "
                f"\"{phrase}\" stays above the bar for longer, so this stops them without missing you."
            )
        if keeps >= 0.8 * len(scores):
            tips.append(
                f"   • Raise WAKEWORD_THRESHOLD to {raise_to}: still wakes on {keeps} of your {len(scores)} attempts."
            )
        tips.append(
            "   • Keep WAKEWORD_VERIFY on (the default): Max double-checks each wake-up with his speech recogniser "
            "and ignores it if he didn't hear the wake word."
        )
        tips.append("   Then apply with 'docker compose --profile max up -d'.")
    for t in tips or ["Mixed results: run the coach again from where you usually sit, and send me the output."]:
        print(f"     {t.strip()}" if t.startswith("   ") else f" - {t}")


if __name__ == "__main__":
    sys.exit(main())
