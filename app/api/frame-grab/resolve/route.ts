import { NextResponse } from "next/server";
import { resolveSource } from "@/lib/frame-grab/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { source?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const source = (body.source ?? "").trim();
  if (!source) return NextResponse.json({ error: "missing_source" }, { status: 400 });

  const res = await resolveSource(source);
  if ("error" in res) return NextResponse.json(res, { status: 502 });

  // Never expose the raw filesystem path — the client uses the video route with `token`.
  const token = Buffer.from(res.videoPath, "utf8").toString("base64url");
  return NextResponse.json({
    sourceId: res.sourceId,
    title: res.title,
    channel: res.channel,
    durationSec: res.durationSec,
    streamUrl: `/api/frame-grab/video?t=${encodeURIComponent(token)}`,
  });
}
