import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extToMime(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".mp4") || p.endsWith(".m4v")) return "video/mp4";
  if (p.endsWith(".webm")) return "video/webm";
  if (p.endsWith(".mkv")) return "video/x-matroska";
  if (p.endsWith(".mov")) return "video/quicktime";
  if (p.endsWith(".avi")) return "video/x-msvideo";
  return "application/octet-stream";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("t");
  if (!token) return new Response("missing_token", { status: 400 });

  let filePath: string;
  try {
    filePath = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return new Response("bad_token", { status: 400 });
  }

  let size: number;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return new Response("not_a_file", { status: 400 });
    size = s.size;
  } catch {
    return new Response("not_found", { status: 404 });
  }

  const mime = extToMime(filePath);
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return new Response("bad_range", { status: 416 });
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (start > end || end >= size) {
      return new Response("range_not_satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const nodeStream = createReadStream(filePath, { start, end });
    const web = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new Response(web, {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }

  const nodeStream = createReadStream(filePath);
  const web = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new Response(web, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
