import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveSource } from "@/lib/frame-grab/extract";
import { runYoutubeFetchSandbox } from "@/lib/frame-grab-sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isYouTube(s: string): boolean {
  try {
    const u = new URL(s);
    return (
      u.hostname === "youtu.be" ||
      u.hostname.endsWith("youtube.com") ||
      u.hostname.endsWith("youtube-nocookie.com")
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: { source?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const source = (body.source ?? "").trim();
  if (!source) return NextResponse.json({ error: "missing_source" }, { status: 400 });

  // YouTube URLs → sandbox: yt-dlp downloads the video and uploads it to
  // private Blob. Client uses the returned pathname (via the source proxy
  // route) for playback and hands the same pathname to /api/frame-grab
  // for extraction.
  if (isYouTube(source)) {
    const jobId = randomBytes(6).toString("hex");
    const yt = await runYoutubeFetchSandbox({ jobId, youtubeUrl: source });
    if ("error" in yt) {
      return NextResponse.json(yt, { status: 502 });
    }
    return NextResponse.json({
      sourceId: yt.videoId ?? jobId,
      title: yt.title || source,
      channel: yt.channel || "youtube",
      durationSec: yt.durationSec,
      sourcePathname: yt.pathname,
      streamUrl: `/api/frame-grab/source?p=${encodeURIComponent(yt.pathname)}`,
    });
  }

  // Local file path (only meaningful in dev). Wrap in try/catch so a spawn
  // failure on Vercel gives a readable JSON error instead of "Unexpected
  // end of JSON input" on the client.
  let res;
  try {
    res = await resolveSource(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "resolve_threw", message: msg },
      { status: 502 },
    );
  }
  if ("error" in res) return NextResponse.json(res, { status: 502 });

  const token = Buffer.from(res.videoPath, "utf8").toString("base64url");
  return NextResponse.json({
    sourceId: res.sourceId,
    title: res.title,
    channel: res.channel,
    durationSec: res.durationSec,
    streamUrl: `/api/frame-grab/video?t=${encodeURIComponent(token)}`,
  });
}
