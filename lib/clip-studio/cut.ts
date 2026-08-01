import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { clipCacheDir } from "./youtube";

export type ClipRequest = {
  start: number;
  end: number;
  /** Optional short label included in the output filename. */
  label?: string;
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

/**
 * Cut one clip from the cached source video. Fast-seek + re-encode with
 * ultrafast so the cut is frame-accurate but still under a couple seconds
 * per clip. Skips work if the target file already exists.
 */
function ffmpeg(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", ...args], { windowsHide: true });
    let stderr = "";
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stderr }));
  });
}

export async function cutClips(
  videoId: string,
  clips: ClipRequest[],
): Promise<{ results: CutResult[]; errors: Array<{ index: number; error: string }> }> {
  const dir = clipCacheDir(videoId);
  const source = join(dir, "video.mp4");
  const outDir = join(dir, "cuts");
  await mkdir(outDir, { recursive: true });
  if (!(await fileExists(source))) {
    return {
      results: [],
      errors: [{ index: -1, error: "source_missing" }],
    };
  }

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
      // Fast-seek before -i for speed, keep re-encode for accuracy.
      const res = await ffmpeg([
        "-ss", c.start.toFixed(3),
        "-i", source,
        "-t", duration.toFixed(3),
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        outPath,
      ]);
      if (res.code !== 0 || !(await fileExists(outPath))) {
        errors.push({ index: i, error: res.stderr.slice(-160) });
        continue;
      }
    }

    results.push({
      start: c.start,
      end: c.end,
      label: c.label,
      filename,
      url: `/api/clip-studio/download?videoId=${encodeURIComponent(videoId)}&file=${encodeURIComponent(filename)}`,
    });
  }
  return { results, errors };
}
