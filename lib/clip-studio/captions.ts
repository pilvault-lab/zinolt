import { writeFile } from "node:fs/promises";
import type { CaptionSegment } from "./youtube";
import type { Orientation } from "../video-treatment";

/**
 * Given the full transcript + a clip window, generate an ASS subtitle file
 * whose text plays in the lower third of the VIDEO AREA:
 *   - full-bleed: lower third of the entire 1080x1920 frame
 *   - letterbox: lower third of the letterboxed video band (not the black bar)
 * Timestamps are rebased to clip-relative.
 */

const PLAY_RES_X = 1080;
const PLAY_RES_Y = 1920;

/** Convert seconds to ASS timecode: H:MM:SS.CC */
function assTime(sec: number): string {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** ASS escape for text field (curly braces are override tags). */
function assEscape(s: string): string {
  return s.replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
}

export type CaptionAssOptions = {
  transcript: CaptionSegment[];
  clipStart: number;
  clipEnd: number;
  outputPath: string;
  orientation: Orientation;
};

export async function writeClipAss(opts: CaptionAssOptions): Promise<void> {
  const { transcript, clipStart, clipEnd, outputPath, orientation } = opts;

  // Filter to segments overlapping the clip window, rebase to clip-relative.
  const rebased = transcript
    .filter((s) => s.end > clipStart && s.start < clipEnd)
    .map((s) => ({
      start: Math.max(0, s.start - clipStart),
      end: Math.min(clipEnd - clipStart, s.end - clipStart),
      text: s.text,
    }))
    .filter((s) => s.end - s.start > 0.1); // drop microscopic segments

  // Positioning: MarginV is distance from bottom edge of PlayRes.
  // - full-bleed: sit ~lower third boundary (~28% up from bottom = MarginV ≈ 540)
  // - letterbox: video band spans y=656..1264; lower third of that starts at
  //   y=1061, so we want text baseline around y=1120. That's 1920-1120 = 800
  //   from the bottom.
  const marginV = orientation === "full-bleed" ? 260 : 800;

  // Vernavle font, white with black outline + soft shadow, bold-ish for
  // readability at social viewing distances.
  const style = [
    "Style: Cap",
    "Vernavle",       // Fontname (matches TTF name registered in /public/brand)
    "56",             // Fontsize
    "&H00FFFFFF",     // PrimaryColour (white)
    "&H000000FF",     // SecondaryColour (unused, karaoke pre-fill)
    "&H00000000",     // OutlineColour (black)
    "&H80000000",     // BackColour (semi-transparent black shadow)
    "0",              // Bold
    "0",              // Italic
    "0",              // Underline
    "0",              // StrikeOut
    "100",            // ScaleX
    "100",            // ScaleY
    "0",              // Spacing
    "0",              // Angle
    "1",              // BorderStyle (1 = outline+shadow)
    "3",              // Outline (px)
    "2",              // Shadow (px)
    "2",              // Alignment (2 = bottom-center)
    "80",             // MarginL
    "80",             // MarginR
    String(marginV),  // MarginV
    "1",              // Encoding
  ].join(",");

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${PLAY_RES_X}
PlayResY: ${PLAY_RES_Y}
ScaledBorderAndShadow: yes
Collisions: Normal
WrapStyle: 0
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${style}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = rebased
    .map(
      (seg) =>
        `Dialogue: 0,${assTime(seg.start)},${assTime(seg.end)},Cap,,0,0,0,,${assEscape(seg.text)}`,
    )
    .join("\n");

  await writeFile(outputPath, header + events + "\n", "utf8");
}
