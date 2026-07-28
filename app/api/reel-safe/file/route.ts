import { promises as fs, createReadStream } from "node:fs";
import { type NextRequest } from "next/server";
import {
  REELSAFE_FILES,
  assertSafeJobId,
  fileExists,
  jobPath,
} from "@/lib/media-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?jobId=X — serves the finished reel-safe MP4. Range-aware so the
 *  browser Player can seek smoothly. */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return new Response("missing_jobId", { status: 400 });
  try {
    assertSafeJobId(jobId);
  } catch {
    return new Response("invalid_jobId", { status: 400 });
  }
  const filePath = jobPath(jobId, REELSAFE_FILES.output);
  if (!(await fileExists(filePath))) {
    return new Response("not_found", { status: 404 });
  }

  const stat = await fs.stat(filePath);
  const total = stat.size;
  const range = req.headers.get("range");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response("invalid_range", { status: 416 });
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
    if (start > end || start >= total) {
      return new Response("range_not_satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    const chunkSize = end - start + 1;
    const stream = createReadStream(filePath, { start, end });
    return new Response(nodeStreamToWeb(stream), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
      },
    });
  }

  const stream = createReadStream(filePath);
  return new Response(nodeStreamToWeb(stream), {
    status: 200,
    headers: {
      "Content-Length": String(total),
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}

function nodeStreamToWeb(
  stream: import("node:stream").Readable,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk: Buffer) => {
        const copied = new Uint8Array(chunk.byteLength);
        copied.set(chunk);
        controller.enqueue(copied);
      });
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });
}
