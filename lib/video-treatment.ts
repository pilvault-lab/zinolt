import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Shared 9:16 video treatment. Builds an ffmpeg command that:
 *  - Takes a source video window [clipStart, clipStart+duration]
 *  - Fits into a 1080x1920 canvas via full-bleed crop OR letterbox
 *  - Overlays the Vernavle watermark
 *  - Optionally burns in a headline (letterbox mode) via drawtext
 *  - Optionally burns in captions via libass
 */

export type Orientation = "full-bleed" | "letterboxed";

export type TreatmentOptions = {
  source: string;
  output: string;
  orientation: Orientation;
  /** In seconds within the source. */
  clipStart: number;
  clipDuration: number;
  /** Vernavle logo overlay path (public path resolved to disk). */
  watermarkPath: string;
  /** Only rendered when orientation === 'letterboxed'. */
  headline?: string;
  /** Absolute path to Vernavle TTF (for drawtext + subtitles). */
  vernavleTtf: string;
  /** Absolute path to an .ass subtitle file. When set, captions are burned in. */
  subtitlesAssPath?: string;
  /** Directory containing font files for libass. */
  fontsDir: string;
};

const OUT_W = 1080;
const OUT_H = 1920;

// Watermark placement: top-right, sized to ~10% of frame height, matches
// the compositions.
const WATERMARK_H = 192;
const WATERMARK_MARGIN_TOP = 100;
const WATERMARK_MARGIN_RIGHT = 60;

// Letterbox: source video occupies the middle band of the canvas.
// A 16:9 source scaled to full width (1080) becomes 1080x608, sitting at
// y = (1920-608)/2 = 656. That leaves ~656px above and below for headline /
// captions.
const LETTERBOX_VIDEO_W = OUT_W;

/** Escape a string for ffmpeg's `drawtext` filter text= value. */
function escapeDrawText(s: string): string {
  // Order matters: escape backslashes first.
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/=/g, "\\=");
}

/** Escape a path for ffmpeg filter parameters (Windows especially). */
function escapePathForFilter(p: string): string {
  // ffmpeg on Windows wants forward slashes AND drive-letter colons escaped
  // inside filter graphs, e.g. C\:/Projects/zinolt/....
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

export function buildTreatmentArgs(opts: TreatmentOptions): string[] {
  const {
    source,
    output,
    orientation,
    clipStart,
    clipDuration,
    watermarkPath,
    headline,
    vernavleTtf,
    subtitlesAssPath,
    fontsDir,
  } = opts;

  // ─── Filter graph ────────────────────────────────────────────────
  const chain: string[] = [];

  // Base 9:16 canvas from source.
  if (orientation === "full-bleed") {
    // Center-crop to 9:16 aspect, then scale to output.
    chain.push(
      `[0:v]crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=${OUT_W}:${OUT_H},setsar=1[bg]`,
    );
  } else {
    // Letterbox: black canvas, source scaled to full width, centered vertically.
    // pad expr = create OUT_W x OUT_H black, place scaled source at x=0, y=centered.
    chain.push(
      `[0:v]scale=${LETTERBOX_VIDEO_W}:-2,setsar=1,pad=${OUT_W}:${OUT_H}:0:(oh-ih)/2:color=black[bg]`,
    );
  }

  // Optional captions layer on top of the base canvas.
  let currentLabel = "bg";
  if (subtitlesAssPath) {
    const escaped = escapePathForFilter(subtitlesAssPath);
    const fontsEscaped = escapePathForFilter(fontsDir);
    chain.push(
      `[${currentLabel}]ass=filename='${escaped}':fontsdir='${fontsEscaped}'[cap]`,
    );
    currentLabel = "cap";
  }

  // Watermark overlay.
  chain.push(
    `[1:v]scale=-1:${WATERMARK_H}[wm]`,
    `[${currentLabel}][wm]overlay=W-w-${WATERMARK_MARGIN_RIGHT}:${WATERMARK_MARGIN_TOP}[wmed]`,
  );
  currentLabel = "wmed";

  // Headline drawtext (letterbox only, above the video block).
  if (orientation === "letterboxed" && headline && headline.trim().length > 0) {
    // Position: horizontally centered, vertically at ~y=300 (above the
    // letterboxed video which starts at y=(1920-608)/2 ≈ 656).
    // fontsize scales down for long lines via boxborderw/text_shaping.
    const fontFile = escapePathForFilter(vernavleTtf);
    const text = escapeDrawText(headline.trim());
    chain.push(
      `[${currentLabel}]drawtext=fontfile='${fontFile}'` +
        `:text='${text}'` +
        `:fontsize=54` +
        `:fontcolor=white` +
        `:line_spacing=8` +
        `:borderw=0` +
        `:x=(w-text_w)/2` +
        `:y=320[final]`,
    );
    currentLabel = "final";
  }

  const filterGraph = chain.join(";");

  // ─── ffmpeg invocation ───────────────────────────────────────────
  return [
    "-y",
    // BOTH `-ss` and `-t` are INPUT options for the source — must sit before
    // its `-i` so they apply to it and not the next input (watermark).
    "-ss", clipStart.toFixed(3),
    "-t", clipDuration.toFixed(3),
    "-i", source,
    "-i", watermarkPath,
    "-filter_complex", filterGraph,
    "-map", `[${currentLabel}]`,
    "-map", "0:a?",
    // Also bound output duration as belt-and-suspenders.
    "-t", clipDuration.toFixed(3),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    output,
  ];
}

/** Convenience runner. Returns exit code + captured stderr. */
export function runFfmpeg(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stderr }));
  });
}

/** Absolute paths for brand assets — resolved once per request. */
export function brandAssetPaths(publicDir: string): {
  watermark: string;
  vernavleTtf: string;
  fontsDir: string;
} {
  return {
    watermark: join(publicDir, "brand", "vernavle-logo.png"),
    vernavleTtf: join(publicDir, "brand", "vernavle.ttf"),
    fontsDir: join(publicDir, "brand"),
  };
}
