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
  /** Only rendered when orientation === 'letterboxed'. Ignored by
   *  buildTreatmentArgs — caller pre-fits + writes a textfile and
   *  passes headlineTextfilePath below. */
  headline?: string;
  /** Absolute path to Vernavle TTF (for drawtext + subtitles). */
  vernavleTtf: string;
  /** Absolute path to an .ass subtitle file. When set, captions are burned in. */
  subtitlesAssPath?: string;
  /** Directory containing font files for libass. */
  fontsDir: string;
  /** Pre-fit headline text file (contents = final wrapped lines). Used
   *  via drawtext textfile= so apostrophes / colons / commas in headlines
   *  never break the filter graph. */
  headlineTextfilePath?: string;
  headlineFontsize?: number;
  /** Number of lines the headline was wrapped into (1 or 2). */
  headlineLineCount?: number;
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

/** Headline (letterbox mode) — layout knobs. */
const HEADLINE = {
  /** Max width as a fraction of frame width. */
  WIDTH_FRAC: 0.88,
  /** Starting font size; shrink towards MIN if the text still overflows. */
  FONTSIZE_START: 62,
  FONTSIZE_MIN: 34,
  /** Max wrapped lines. */
  MAX_LINES: 2,
  /** Rough Vernavle glyph width as a fraction of em (matches captions estimate). */
  AVG_GLYPH_WIDTH_EM: 0.5,
  /** Video panel top edge — where the letterboxed source starts.
   *  Headline block's BOTTOM sits just above this, gap px away. */
  VIDEO_TOP_Y: 656,
  /** Pixels between the headline's bottom edge and the video panel top. */
  BOTTOM_GAP: 20,
  /** Line-height as a factor of font size. */
  LINE_HEIGHT: 1.15,
} as const;

/** Greedy wrap + auto-shrink. Returns lines (never exceeds MAX_LINES) plus
 *  the fontsize that fits. Falls back to FONTSIZE_MIN if nothing fits. */
export function fitHeadline(text: string): { lines: string[]; fontsize: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [], fontsize: HEADLINE.FONTSIZE_START };
  const maxWidthPx = OUT_W * HEADLINE.WIDTH_FRAC;

  const wrapAt = (fs: number): string[] | null => {
    const maxChars = Math.floor(maxWidthPx / (fs * HEADLINE.AVG_GLYPH_WIDTH_EM));
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      // A single word longer than maxChars can't fit even alone — force it on its own line;
      // outer loop will detect the shrink need.
      const test = cur ? cur + " " + w : w;
      if (test.length <= maxChars) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length > HEADLINE.MAX_LINES) return null;
    if (lines.some((l) => l.length > maxChars)) return null;
    return lines;
  };

  for (let fs = HEADLINE.FONTSIZE_START; fs >= HEADLINE.FONTSIZE_MIN; fs -= 2) {
    const lines = wrapAt(fs);
    if (lines) return { lines, fontsize: fs };
  }
  // Last-resort: force fit at MIN, may still overflow but centered.
  const fs = HEADLINE.FONTSIZE_MIN;
  return { lines: wrapAt(fs) ?? [text.slice(0, 60)], fontsize: fs };
}

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
  // Wrapped to ≤2 lines at ≤88% frame width, auto-shrunk font, centered
  // in the black band between the frame top (y=0) and video panel top
  // (y≈656). Rendered as one drawtext per line with y computed from
  // text_h so the line block is precisely centered on HEADLINE.Y_CENTER.
  if (
    orientation === "letterboxed" &&
    opts.headlineTextfilePath &&
    opts.headlineFontsize &&
    opts.headlineLineCount &&
    opts.headlineLineCount > 0
  ) {
    const fontFile = escapePathForFilter(vernavleTtf);
    const textfile = escapePathForFilter(opts.headlineTextfilePath);
    const fontsize = opts.headlineFontsize;
    const lineHeightPx = Math.round(fontsize * HEADLINE.LINE_HEIGHT);
    // Anchor block's bottom edge BOTTOM_GAP px above the video panel top.
    const bottomAnchor = HEADLINE.VIDEO_TOP_Y - HEADLINE.BOTTOM_GAP;

    if (opts.headlineLineCount === 1) {
      chain.push(
        `[${currentLabel}]drawtext=fontfile='${fontFile}'` +
          `:textfile='${textfile}'` +
          `:fontsize=${fontsize}` +
          `:fontcolor=white` +
          `:text_shaping=1` +
          `:borderw=0` +
          `:x=(w-text_w)/2` +
          `:y=${bottomAnchor}-text_h[final]`,
      );
      currentLabel = "final";
    } else {
      // 2-line file: drawtext reads both lines from the file, aligns to a
      // single top-left. Anchor block's bottom via text_h (which is total
      // height of both lines).
      chain.push(
        `[${currentLabel}]drawtext=fontfile='${fontFile}'` +
          `:textfile='${textfile}'` +
          `:fontsize=${fontsize}` +
          `:fontcolor=white` +
          `:text_shaping=1` +
          `:borderw=0` +
          `:line_spacing=${Math.max(0, lineHeightPx - fontsize)}` +
          `:x=(w-text_w)/2` +
          `:y=${bottomAnchor}-text_h[final]`,
      );
      currentLabel = "final";
    }
  }

  void headline; // silence unused warning while we prefer the textfile path

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
