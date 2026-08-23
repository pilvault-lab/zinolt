import { createReadStream, statSync } from "node:fs";
import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { resolveAudioPath } from "@/lib/waveform-reel/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simple ranged-audio proxy so <audio> and Remotion's <Audio> can stream cached
// tracks from .waveform-reel-cache/ without exposing the filesystem.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  if (!/^[\w-]+$/.test(key)) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }
  const resolved = await resolveAudioPath(key);
  if (!resolved) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { path, mime } = resolved;

  const stat = statSync(path);
  const size = stat.size;
  const range = req.headers.get("range");

  const baseHeaders: HeadersInit = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  };

  if (range) {
    const m = /bytes=(\d+)-(\d+)?/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : size - 1;
      if (start >= size || end >= size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "content-range": `bytes */${size}` },
        });
      }
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
      return new NextResponse(stream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "content-range": `bytes ${start}-${end}/${size}`,
          "content-length": String(end - start + 1),
        },
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: { ...baseHeaders, "content-length": String(size) },
  });
}
