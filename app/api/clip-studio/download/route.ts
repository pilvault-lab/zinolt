import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { clipCacheDir } from "@/lib/clip-studio/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guard: filenames must be simple (letters/digits/dash/underscore/dot). */
function isSafeName(name: string): boolean {
  return /^[A-Za-z0-9._-]+\.mp4$/.test(name) && !name.includes("..");
}

/** GET /api/clip-studio/download?videoId=...&file=...&mode=... */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const videoId = (url.searchParams.get("videoId") ?? "").trim();
  const file = (url.searchParams.get("file") ?? "").trim();
  const mode = (url.searchParams.get("mode") ?? "").trim();
  if (!videoId || !file) return NextResponse.json({ error: "missing_params" }, { status: 400 });
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return NextResponse.json({ error: "invalid_video_id" }, { status: 400 });
  }
  if (!isSafeName(file)) return NextResponse.json({ error: "invalid_file" }, { status: 400 });
  if (mode && !/^[a-z-]{1,40}$/.test(mode)) {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }

  const filePath = mode
    ? join(clipCacheDir(videoId), "cuts", mode, file)
    : join(clipCacheDir(videoId), "cuts", file);
  try {
    const s = await stat(filePath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = createReadStream(filePath) as any;
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(s.size),
        "content-disposition": `attachment; filename="${file}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
