/**
 * Hype Edit — BPM-synced finance/company montage.
 *
 * A project is an ordered list of "frames" (image / video / solid colour) that
 * are cut on the beat of the selected audio track. Video length = audio
 * length; frames loop to fill it.
 *
 * The composition is 1080×1920 with a letterboxed 16:9 stage centred
 * vertically — all frames render inside that stage, black bars top/bottom.
 */

export type HypeFrameKind = "image" | "video" | "solid";

export type HypeFrame = {
  id: string;
  kind: HypeFrameKind;
  /** Path/URL for image or video. Ignored for solid. */
  src?: string;
  /** Hex string (e.g. "#0F0F0F") for solid frames. */
  color?: string;
  /** Small human label shown in the frames panel. */
  label?: string;
  /** For video: seconds into the source clip. */
  startAt?: number;
  /** Session-only marker — this frame's src is a blob URL that won't survive
   *  a reload; excluded from Save/localStorage. */
  session?: boolean;
};

export type HypeSettings = {
  /** Composition fps. 60 is the target; 30 halves render time. */
  fps: 30 | 60;
  /** H.264 bitrate in bits/sec. */
  bitrate: number;
  /** Show Vernavle logo flash at t=0. */
  introFlash: boolean;
  /** Persistent Vernavle mark, bottom-right. */
  watermark: boolean;
  /** Override auto-transitions with a single set: undefined = auto (BPM-based). */
  transitionMode: "auto" | "hard" | "smooth";
  /** Frame stage: full-bleed 9:16 crop, or 16:9 letterboxed centered vertically. */
  stageMode: "full-bleed" | "letterboxed";
};

export const DEFAULT_SETTINGS: HypeSettings = {
  fps: 60,
  bitrate: 18_000_000,
  introFlash: true,
  watermark: true,
  transitionMode: "auto",
  stageMode: "full-bleed",
};

export type HypeProject = {
  frames: HypeFrame[];
  /** Filename in /public/hype-edit/audio (preset-N.mp3, or custom/foo.mp3). */
  audioFile: string;
  /** Optional user override for the track's BPM (else server sidecar). */
  bpmOverride?: number;
  settings: HypeSettings;
};

export const EMPTY_PROJECT: HypeProject = {
  frames: [],
  audioFile: "",
  settings: DEFAULT_SETTINGS,
};
