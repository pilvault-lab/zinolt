import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tiktokCacheDir } from "@/lib/tiktok/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  // TikTok video IDs are long numeric strings; allow word chars + hyphens.
  if (!/^[\w-]{1,50}$/.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const filePath = join(tiktokCacheDir(id), "branded.mp4");
  try {
    const s = await stat(filePath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = createReadStream(filePath) as any;
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(s.size),
        "content-disposition": `attachment; filename="tiktok-${id}.mp4"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
