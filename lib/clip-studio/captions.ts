import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptionSegment } from "./youtube";
import { clipCacheDir } from "./youtube";
import type { Orientation } from "../video-treatment";
import {
  CAPTION_FILLER_WORDS,
  CAPTIONS_CONFIG as C,
} from "./captions-config";

const PLAY_RES_X = 1080;
const PLAY_RES_Y = 1920;

/* ---------- Types --------------------------------------------------- */

type Word = { text: string; start: number; end: number };
type Group = { start: number; end: number; text: string };

/* ---------- Word extraction ---------------------------------------- */

/**
 * Parse the same .json3 files we already cached to extract WORD-level
 * timings. YouTube's `segs[i].tOffsetMs` gives us per-word start
 * offsets when the ASR path was word-tagged (auto-captions on speech
 * content typically are). If a segment is just one blob without
 * per-word offsets (lyrics, some short segments), we subdivide the
 * segment duration equally across its words.
 */
async function loadWords(videoId: string): Promise<Word[]> {
  const dir = clipCacheDir(videoId);
  const candidates = [
    `${videoId}.en.json3`,
    `${videoId}.en-orig.json3`,
    `${videoId}.en-en.json3`,
    "captions.en.json3",
  ];
  for (const name of candidates) {
    try {
      const raw = JSON.parse(
        await readFile(join(dir, name), "utf8"),
      ) as {
        events?: Array<{
          tStartMs?: number;
          dDurationMs?: number;
          segs?: Array<{ utf8?: string; tOffsetMs?: number }>;
        }>;
      };
      const words = extractWords(raw.events ?? []);
      if (words.length > 0) return words;
    } catch {
      /* try next file */
    }
  }
  return [];
}

function extractWords(
  events: Array<{
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string; tOffsetMs?: number }>;
  }>,
): Word[] {
  const out: Word[] = [];
  for (const e of events) {
    const startMs = e.tStartMs;
    const durMs = e.dDurationMs;
    const segs = e.segs ?? [];
    if (typeof startMs !== "number" || typeof durMs !== "number" || segs.length === 0) continue;

    // Path A: segs have per-word tOffsetMs — treat each seg as one word.
    const anyOffset = segs.some((s, i) => i > 0 && typeof s.tOffsetMs === "number");
    if (anyOffset) {
      for (let i = 0; i < segs.length; i++) {
        const text = (segs[i].utf8 ?? "").replace(/\n+/g, " ").trim();
        if (!text) continue;
        const wStartMs = startMs + (segs[i].tOffsetMs ?? 0);
        const nextOffset =
          i + 1 < segs.length && typeof segs[i + 1].tOffsetMs === "number"
            ? segs[i + 1].tOffsetMs!
            : durMs;
        const wEndMs = startMs + nextOffset;
        out.push({ text, start: wStartMs / 1000, end: wEndMs / 1000 });
      }
      continue;
    }

    // Path B: one lump per event — split on whitespace, subdivide duration.
    const full = segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\n+/g, " ")
      .trim();
    if (!full) continue;
    const tokens = full.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const per = durMs / tokens.length;
    for (let i = 0; i < tokens.length; i++) {
      out.push({
        text: tokens[i],
        start: (startMs + i * per) / 1000,
        end: (startMs + (i + 1) * per) / 1000,
      });
    }
  }
  return out;
}

/* ---------- Grouping ---------------------------------------------- */

function stripPunct(s: string) {
  return s.toLowerCase().replace(/[^a-z']/g, "");
}

function isFiller(word: string): boolean {
  return CAPTION_FILLER_WORDS.has(stripPunct(word));
}

/**
 * Cut a word stream into MAX_WORDS_PER_GROUP chunks, extending up to
 * ORPHAN_EXTEND_TO if the natural cut would leave a trailing filler
 * (article, prep, aux verb) at the end of a group.
 */
function chunkWords(words: Word[]): Group[] {
  const groups: Group[] = [];
  let i = 0;
  while (i < words.length) {
    let size = Math.min(C.MAX_WORDS_PER_GROUP, words.length - i);
    // If the last word in the group is a filler AND there are more words
    // to pull, extend until we hit a non-filler or the extend cap.
    while (
      size < C.ORPHAN_EXTEND_TO &&
      i + size < words.length &&
      isFiller(words[i + size - 1].text)
    ) {
      size++;
    }
    const slice = words.slice(i, i + size);
    groups.push({
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      text: slice.map((w) => w.text.trim()).join(" ").trim(),
    });
    i += size;
  }
  return groups;
}

/* ---------- ASS emission ------------------------------------------ */

function assTime(sec: number): string {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assEscape(s: string): string {
  return s.replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
}

/** Rough width estimate for auto-shrink. */
function estimatePx(text: string, fontsize: number): number {
  return text.length * fontsize * C.AVG_GLYPH_WIDTH_EM;
}

function fontsizeFor(text: string): number {
  const maxWidth = PLAY_RES_X * C.TARGET_WIDTH_PCT;
  let fs: number = C.FONTSIZE_DEFAULT;
  if (estimatePx(text, fs) > maxWidth) {
    fs = Math.floor(maxWidth / (text.length * C.AVG_GLYPH_WIDTH_EM));
  }
  return Math.max(C.FONTSIZE_MIN, Math.min(C.FONTSIZE_DEFAULT, fs));
}

/* ---------- Public API -------------------------------------------- */

export type CaptionAssOptions = {
  /** Legacy: full transcript (unused now — kept so callers don't break). */
  transcript?: CaptionSegment[];
  /** Optional videoId to load word-level captions from json3 cache. */
  videoId?: string;
  clipStart: number;
  clipEnd: number;
  outputPath: string;
  orientation: Orientation;
};

/**
 * Emit an ASS subtitle file for a single clip window with the new style:
 *   - one MAX_WORDS_PER_GROUP-word group visible at a time (no stacking)
 *   - no box, no outline
 *   - soft drop shadow via \shad + \blur
 *   - centered horizontally, y anchored by orientation config
 *   - auto-shrink if a group would overflow width
 */
export async function writeClipAss(opts: CaptionAssOptions): Promise<void> {
  const { clipStart, clipEnd, outputPath, orientation } = opts;

  // Pull word-level timings from the cached json3 when we have a videoId;
  // otherwise fall back to the segment-based transcript (equal subdivision).
  let words: Word[] = [];
  if (opts.videoId) {
    words = await loadWords(opts.videoId);
  }
  if (words.length === 0 && opts.transcript?.length) {
    // Subdivide segment-level text into words with linear timings.
    for (const seg of opts.transcript) {
      const tokens = seg.text.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      const per = (seg.end - seg.start) / tokens.length;
      for (let i = 0; i < tokens.length; i++) {
        words.push({
          text: tokens[i],
          start: seg.start + i * per,
          end: seg.start + (i + 1) * per,
        });
      }
    }
  }

  // Filter to the clip window, rebase to clip-relative, chunk.
  const inWindow = words
    .filter((w) => w.end > clipStart && w.start < clipEnd)
    .map((w) => ({
      text: w.text,
      start: Math.max(0, w.start - clipStart),
      end: Math.min(clipEnd - clipStart, w.end - clipStart),
    }))
    .filter((w) => w.end - w.start > 0.02);

  const groups = chunkWords(inWindow);

  // Enforce STRICT non-overlap between consecutive groups. libass draws
  // any Dialogue whose window contains the current frame — two groups
  // sharing an exact boundary can render simultaneously on a boundary
  // frame, which is the ghosting bug. Clamp each group's end to just
  // before the next group's start.
  const EPS = 0.02;
  for (let i = 0; i < groups.length - 1; i++) {
    const cap = groups[i + 1].start - EPS;
    if (groups[i].end > cap) groups[i].end = cap;
    // If the group would be non-positive after clamping, drop it —
    // means the source words overlapped past the next group entirely.
    if (groups[i].end <= groups[i].start) {
      groups[i].end = groups[i].start + EPS;
    }
  }

  const yFrac =
    orientation === "full-bleed" ? C.FULLBLEED_Y_FRAC : C.LETTERBOXED_Y_FRAC;
  const x = Math.round(PLAY_RES_X * C.X_CENTER_FRAC);
  const y = Math.round(PLAY_RES_Y * yFrac);

  // Style: no outline, soft shadow, alignment 5 (middle-center anchor
  // for \pos). Font size will typically be overridden per-line via \fs.
  const style = [
    "Style: Cap",
    C.FONTNAME,
    String(C.FONTSIZE_DEFAULT),
    C.PRIMARY_COLOUR,
    "&H000000FF",     // SecondaryColour (unused)
    "&H00000000",     // OutlineColour
    C.SHADOW_COLOUR,  // BackColour = shadow colour
    "0",              // Bold
    "0",              // Italic
    "0",              // Underline
    "0",              // StrikeOut
    "100",            // ScaleX
    "100",            // ScaleY
    "0",              // Spacing
    "0",              // Angle
    "1",              // BorderStyle: 1 = outline+shadow (NOT 3 which is box)
    String(C.OUTLINE_PX),
    String(C.SHADOW_PX),
    "5",              // Alignment 5 = middle-center (anchor for \pos)
    "0",              // MarginL
    "0",              // MarginR
    "0",              // MarginV (unused with \pos)
    "1",              // Encoding
  ].join(",");

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${PLAY_RES_X}
PlayResY: ${PLAY_RES_Y}
ScaledBorderAndShadow: yes
Collisions: Normal
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${style}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = groups
    .map((g) => {
      const fs = fontsizeFor(g.text);
      const overrides = `{\\pos(${x},${y})\\fs${fs}\\blur${C.SHADOW_BLUR}}`;
      return `Dialogue: 0,${assTime(g.start)},${assTime(g.end)},Cap,,0,0,0,,${overrides}${assEscape(g.text)}`;
    })
    .join("\n");

  await writeFile(outputPath, header + events + "\n", "utf8");
}
