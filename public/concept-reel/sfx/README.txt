Concept Reel SFX

Drop short (<400ms) mp3/wav one-shots here, then register each in
`SFX_MANIFEST` at the top of the DiagramBody section of
remotion/concept-reel/ConceptReelComposition.tsx.

Expected filenames (recommended):
  click.mp3   — mechanical letter/tick sound for card + text reveals
  pop.mp3     — soft synth pop for card entries
  tick.mp3    — hard tick for montage frames
  ding.mp3    — bright accent (rarely used)
  swell.mp3   — 1-2s soft riser for outros
  whoosh.mp3  — reserved (unused for now; hook is silent)

Any variant that isn't registered in SFX_MANIFEST is silently ignored, so
scripts stay declarative without breaking preview before assets exist.
