import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_EXT = [".mp3", ".m4a", ".wav", ".ogg", ".aac"];

export type HypeAudioTrack = {
  /** Path relative to /public (e.g. "hype-edit/audio/preset-1.mp3"). */
  file: string;
  /** Bare filename for display. */
  name: string;
  /** "preset" or "custom". */
  kind: "preset" | "custom";
  /** Preset slot 1..6 for the UI's 2-col grid. */
  presetSlot?: number;
  /** BPM read from `{file}.bpm` sidecar, if present. */
  bpm?: number;
};

async function readBpm(dir: string, file: string): Promise<number | undefined> {
  const base = file.replace(/\.[^./]+$/, "");
  const sidecar = path.join(dir, `${base}.bpm`);
  try {
    const raw = (await readFile(sidecar, "utf8")).trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n < 400) return n;
  } catch {
    /* no sidecar */
  }
  return undefined;
}

async function listDir(
  absDir: string,
  publicPrefix: string,
): Promise<{ file: string; name: string }[]> {
  try {
    const entries = await readdir(absDir);
    return entries
      .filter((f) => AUDIO_EXT.some((e) => f.toLowerCase().endsWith(e)))
      .map((name) => ({ file: `${publicPrefix}/${name}`, name }));
  } catch {
    return [];
  }
}

export async function GET() {
  const audioDir = path.join(process.cwd(), "public", "hype-edit", "audio");
  const customDir = path.join(audioDir, "custom");

  const [presetFiles, customFiles] = await Promise.all([
    listDir(audioDir, "hype-edit/audio"),
    listDir(customDir, "hype-edit/audio/custom"),
  ]);

  const presetTracks: HypeAudioTrack[] = await Promise.all(
    presetFiles.map(async (f) => {
      const bpm = await readBpm(audioDir, f.name);
      // Match preset-1.mp3, audio-1.m4a, etc. — either naming works.
      const m = f.name.match(/^(?:preset|audio)-(\d+)\./i);
      return {
        file: f.file,
        name: f.name,
        kind: "preset" as const,
        presetSlot: m ? Number(m[1]) : undefined,
        bpm,
      };
    }),
  );

  const customTracks: HypeAudioTrack[] = await Promise.all(
    customFiles.map(async (f) => {
      const bpm = await readBpm(customDir, f.name);
      return {
        file: f.file,
        name: f.name,
        kind: "custom" as const,
        bpm,
      };
    }),
  );

  // Suppress unused import warning
  void stat;

  return NextResponse.json({
    presets: presetTracks.sort(
      (a, b) => (a.presetSlot ?? 999) - (b.presetSlot ?? 999),
    ),
    custom: customTracks.sort((a, b) => a.name.localeCompare(b.name)),
  });
}
