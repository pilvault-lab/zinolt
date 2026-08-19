import { NextResponse } from "next/server";
import { get } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a private narration MP3 through with the server-side Blob token.
 * The store is private-access-only, so client `<audio src>` can't hit the
 * blob URL directly. This proxy reads the requested pathname (constrained
 * to concept-reel/narrations/*) and pipes the bytes back with the origin
 * Content-Type / Content-Length.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pathname = url.searchParams.get("p") ?? "";
  if (!pathname.startsWith("concept-reel/narrations/") || pathname.includes("..")) {
    return NextResponse.json({ error: "bad_path" }, { status: 400 });
  }

  try {
    const result = await get(pathname, {
      access: "private",
      // Range headers from mobile <audio> get forwarded so seek works.
      headers: req.headers.get("range")
        ? { range: req.headers.get("range")! }
        : undefined,
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const headers = new Headers();
    const contentType = result.headers.get("content-type") ?? "audio/mpeg";
    headers.set("content-type", contentType);
    const contentLength = result.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);
    const contentRange = result.headers.get("content-range");
    if (contentRange) headers.set("content-range", contentRange);
    const acceptRanges = result.headers.get("accept-ranges");
    if (acceptRanges) headers.set("accept-ranges", acceptRanges);
    // Cache the mp3 aggressively — the pathname is unique per generation.
    headers.set("cache-control", "public, max-age=604800, immutable");
    // 206 if the origin returned a partial (Range hit), 200 otherwise.
    const status = contentRange ? 206 : 200;
    return new Response(result.stream, { status, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "blob_get_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
