import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Stream the request body to disk under .frame-grab-uploads/{hash}/{name}.
 * Client sends the file bytes as the raw body and metadata via querystring.
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = (searchParams.get("name") ?? "").trim();
  const size = Number(searchParams.get("size") ?? "0");
  const lastModified = Number(searchParams.get("lastModified") ?? "0");
  if (!name || !size) {
    return NextResponse.json({ error: "missing_name_or_size" }, { status: 400 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "missing_body" }, { status: 400 });
  }

  const safeName = basename(name).replace(/[^\w.-]+/g, "_").slice(0, 80);
  const hash = createHash("sha1")
    .update(`${name}:${size}:${lastModified}`)
    .digest("hex")
    .slice(0, 12);
  const dir = join(process.cwd(), ".frame-grab-uploads", hash);
  await mkdir(dir, { recursive: true });
  const destPath = join(dir, safeName);

  const nodeReadable = Readable.fromWeb(req.body as unknown as NodeWebReadableStream);
  const out = createWriteStream(destPath);
  try {
    await pipeline(nodeReadable, out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "write_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ path: destPath, name: safeName, size });
}
