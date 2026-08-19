import { NextResponse } from "next/server";
import { get } from "@vercel/blob";

/**
 * Shared proxy handler for private Blob content served to the client.
 * Constrains the pathname to a whitelisted prefix, forwards Range headers
 * from mobile `<video>` / `<audio>` elements so seek works, and mirrors
 * origin Content-Type / Content-Length / Content-Range headers back.
 */
export async function proxyPrivateBlob(
  req: Request,
  allowedPrefix: string,
): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.searchParams.get("p") ?? "";
  if (!pathname.startsWith(allowedPrefix) || pathname.includes("..")) {
    return NextResponse.json({ error: "bad_path" }, { status: 400 });
  }

  try {
    const range = req.headers.get("range");
    const result = await get(pathname, {
      access: "private",
      headers: range ? { range } : undefined,
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const headers = new Headers();
    headers.set(
      "content-type",
      result.headers.get("content-type") ?? "application/octet-stream",
    );
    const contentLength = result.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);
    const contentRange = result.headers.get("content-range");
    if (contentRange) headers.set("content-range", contentRange);
    const acceptRanges = result.headers.get("accept-ranges");
    if (acceptRanges) headers.set("accept-ranges", acceptRanges);
    headers.set("cache-control", "public, max-age=604800, immutable");
    return new Response(result.stream, {
      status: contentRange ? 206 : 200,
      headers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "blob_get_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
