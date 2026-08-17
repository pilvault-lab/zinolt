# Hype Edit — audio

Two folders:

- `./` — presets. Files named `audio-1.mp3` … `audio-6.mp3` (or
  `preset-1.mp3` … `preset-6.mp3` — either naming works, any audio ext)
  populate the six "Audio 1–6" buttons in the studio.
- `./custom/` — anything else. Shows up in the "Custom audio" section.

For each track drop a plain-text sidecar with the same base name and a `.bpm`
extension containing the integer BPM, e.g. `preset-1.bpm`:

```
128
```

Without a sidecar the timeline still renders, but ticks fall back to 120 BPM
and cuts won't be synced to your track.

### Auto-detect BPM

Run the helper (requires `pip install librosa` once):

```
python scripts/detect-bpm.py public/hype-edit/audio/Audio-1.mp3
python scripts/detect-bpm.py --all                 # every track in this folder
python scripts/detect-bpm.py --all --force         # re-detect and overwrite
```

Detected tempos are folded into the 70–180 BPM range, since beat trackers
often return half/double the perceived tempo.
