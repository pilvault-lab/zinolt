"""
Detect BPM of one or more audio files and write `.bpm` sidecars next to them.

    python scripts/detect-bpm.py public/hype-edit/audio/Audio-1.mp3
    python scripts/detect-bpm.py --all         # every audio in public/hype-edit/audio (and /custom)
    python scripts/detect-bpm.py --force ...   # overwrite existing sidecars

Requires: librosa (pip install librosa).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"}
DEFAULT_ROOTS = [
    Path("public/hype-edit/audio"),
    Path("public/hype-edit/audio/custom"),
]


def detect_bpm(path: Path) -> int:
    import librosa
    import numpy as np

    y, sr = librosa.load(str(path), sr=22050, mono=True)
    tempo_arr, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.atleast_1d(tempo_arr)[0])
    # Beat trackers routinely return half/double the perceived tempo.
    # Fold into the typical musical range so cuts don't feel too slow/fast.
    while tempo < 70:
        tempo *= 2
    while tempo > 180:
        tempo /= 2
    return int(round(tempo))


def iter_audio(paths: list[Path]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            for f in sorted(p.iterdir()):
                if f.is_file() and f.suffix.lower() in AUDIO_EXTS:
                    out.append(f)
        elif p.is_file() and p.suffix.lower() in AUDIO_EXTS:
            out.append(p)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*", help="Audio files or folders")
    ap.add_argument("--all", action="store_true", help="Scan the default hype-edit audio folders")
    ap.add_argument("--force", action="store_true", help="Overwrite existing .bpm sidecars")
    args = ap.parse_args()

    targets: list[Path] = []
    if args.all:
        targets = iter_audio([p for p in DEFAULT_ROOTS if p.exists()])
    if args.paths:
        targets += iter_audio([Path(p) for p in args.paths])

    if not targets:
        print("No audio files found. Pass paths or --all.", file=sys.stderr)
        return 1

    for f in targets:
        sidecar = f.with_suffix(".bpm")
        if sidecar.exists() and not args.force:
            print(f"skip  {f.name}  (sidecar exists — use --force)")
            continue
        try:
            bpm = detect_bpm(f)
        except Exception as e:  # noqa: BLE001
            print(f"FAIL  {f.name}: {e}", file=sys.stderr)
            continue
        sidecar.write_text(f"{bpm}\n", encoding="utf-8")
        print(f"OK    {f.name}  →  {bpm} BPM  ({sidecar.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
