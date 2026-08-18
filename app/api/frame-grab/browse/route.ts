import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mts", ".m2ts"]);

type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("dir");
  const dir = raw && raw.trim() ? resolve(raw) : (process.env.FRAME_GRAB_BROWSE_ROOT || homedir());

  let entries: Entry[] = [];
  try {
    const names = await readdir(dir);
    const results = await Promise.all(
      names.map(async (name): Promise<Entry | null> => {
        const path = join(dir, name);
        try {
          const s = await stat(path);
          const isDir = s.isDirectory();
          if (!isDir) {
            const dot = name.lastIndexOf(".");
            const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
            if (!VIDEO_EXT.has(ext)) return null;
          }
          return { name, path, isDir, size: s.size, mtimeMs: s.mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    entries = results.filter((e): e is Entry => e !== null);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "read_failed", dir },
      { status: 400 },
    );
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parent = dirname(dir);
  return NextResponse.json({
    dir,
    parent: parent === dir ? null : parent,
    entries,
  });
}
