export type AudioTrack = {
  label: string;
  // Path under /public, e.g. "audio/track-01.mp3". Empty string = no audio.
  file: string;
};

export const AUDIO_TRACKS: AudioTrack[] = [
  { label: "No audio", file: "" },
  {
    label: "Ambient Astronomy",
    file: "audio/atlasaudio-ambient-astronomy-511860.mp3",
  },
  {
    label: "Ambient Nature",
    file: "audio/atlasaudio-ambient-nature-518687.mp3",
  },
  {
    label: "Ambient Dreamscape",
    file: "audio/morgan-ambient-calm-ambient-dreamscape-529861 (1).mp3",
  },
];
