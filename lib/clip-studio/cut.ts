import { mkdir, access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clipCacheDir, type CaptionSegment } from "./youtube";
import { writeClipAss } from "./captions";
import {
  brandAssetPaths,
  buildTreatmentArgs,
  fitHeadline,
  runFfmpeg,
  type Orientation,
} from "../video-treatment";

export type ClipRequest = {
  start: number;
  end: number;
  label?: string;
  /** Optional per-clip headline text (letterbox mode only). */
  headline?: string;
};

export type CutOptions = {
  orientation: Orientation;
  burnCaptions: boolean;
};

export type CutResult = {
  start: number;
  end: number;
  label?: string;
  filename: string;
  url: string;
};

function slug(s: string, max = 40) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "clip"
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadTranscript(videoId: string): Promise<CaptionSegment[]> {
  const dir = clipCacheDir(videoId);
  const candidates = [
    join(dir, `${videoId}.en.json3`),
    join(dir, `${videoId}.en-orig.json3`),
    join(dir, `${videoId}.en-en.json3`),
    join(dir, "captions.en.json3"),
  ];
  for (const p of candidates) {
    if (!(await fileExists(p))) continue;
    try {
      const raw = JSON.parse(await readFile(p, "utf8")) as {
        events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }>;
      };
      const events = raw.events ?? [];
      const out: CaptionSegment[] = [];
      for (const e of events) {
        const startMs = e.tStartMs;
        const durMs = e.dDurationMs;
        if (typeof startMs !== "number" || typeof durMs !== "number") continue;
        const text = (e.segs ?? [])
          .map((s) => s.utf8 ?? "")
          .join("")
          .replace(/\n+/g, " ")
          .trim();
        if (!text) continue;
        out.push({ start: startMs / 1000, end: (startMs + durMs) / 1000, text });
      }
      if (out.length > 0) return out;
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function cutClips(
  videoId: string,
  clips: ClipRequest[],
  opts: CutOptions,
): Promise<{ results: CutResult[]; errors: Array<{ index: number; error: string }> }> {
  const dir = clipCacheDir(videoId);
  const source = join(dir, "video.mp4");
  // Distinct output directory per (orientation, captions) combination so
  // switching modes doesn't overwrite previous renders.
  const modeTag = `${opts.orientation}${opts.burnCaptions ? "-cc" : ""}`;
  const outDir = join(dir, "cuts", modeTag);
  await mkdir(outDir, { recursive: true });

  if (!(await fileExists(source))) {
    return { results: [], errors: [{ index: -1, error: "source_missing" }] };
  }

  const brand = brandAssetPaths(join(process.cwd(), "public"));
  const transcript = opts.burnCaptions ? await loadTranscript(videoId) : [];

  const results: CutResult[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (!(c.end > c.start) || c.start < 0) {
      errors.push({ index: i, error: "invalid_range" });
      continue;
    }
    const duration = c.end - c.start;
    const startFixed = c.start.toFixed(2).replace(".", "-");
    const endFixed = c.end.toFixed(2).replace(".", "-");
    const labelPart = c.label ? `_${slug(c.label, 30)}` : "";
    const filename = `clip-${String(i + 1).padStart(2, "0")}_${startFixed}s-${endFixed}s${labelPart}.mp4`;
    const outPath = join(outDir, filename);

    if (!(await fileExists(outPath))) {
      // Write per-clip ASS subtitles when captions are on.
      let subtitlesAssPath: string | undefined;
      if (opts.burnCaptions && transcript.length > 0) {
        subtitlesAssPath = join(outDir, `clip-${String(i + 1).padStart(2, "0")}.ass`);
        await writeClipAss({
          videoId,           // enables word-level chunking from the json3 cache
          transcript,        // fallback if json3 lookup is empty
          clipStart: c.start,
          clipEnd: c.end,
          outputPath: subtitlesAssPath,
          orientation: opts.orientation,
        });
      }

      // Letterbox headline: pre-fit + write a textfile so drawtext can
      // pull the (possibly apostrophe-laden) text without escape hell.
      let headlineTextfilePath: string | undefined;
      let headlineFontsize: number | undefined;
      let headlineLineCount: number | undefined;
      if (opts.orientation === "letterboxed" && c.headline && c.headline.trim()) {
        const fit = fitHeadline(c.headline);
        headlineFontsize = fit.fontsize;
        headlineLineCount = fit.lines.length;
        headlineTextfilePath = join(
          outDir,
          `clip-${String(i + 1).padStart(2, "0")}.headline.txt`,
        );
        await writeFile(headlineTextfilePath, fit.lines.join("\n"), "utf8");
      }

      const args = buildTreatmentArgs({
        source,
        output: outPath,
        orientation: opts.orientation,
        clipStart: c.start,
        clipDuration: duration,
        watermarkPath: brand.watermark,
        headline: opts.orientation === "letterboxed" ? c.headline : undefined,
        vernavleTtf: brand.vernavleTtf,
        subtitlesAssPath,
        fontsDir: brand.fontsDir,
        headlineTextfilePath,
        headlineFontsize,
        headlineLineCount,
      });
      const res = await runFfmpeg(args);
      if (res.code !== 0 || !(await fileExists(outPath))) {
        errors.push({ index: i, error: res.stderr.slice(-200) });
        continue;
      }
    }

    results.push({
      start: c.start,
      end: c.end,
      label: c.label,
      filename,
      url:
        `/api/clip-studio/download?videoId=${encodeURIComponent(videoId)}` +
        `&file=${encodeURIComponent(filename)}` +
        `&mode=${encodeURIComponent(modeTag)}`,
    });
  }
  return { results, errors };
}
