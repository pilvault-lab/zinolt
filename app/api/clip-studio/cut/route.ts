import { NextResponse } from "next/server";
import { cutClips, type ClipRequest } from "@/lib/clip-studio/cut";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { videoId?: string; clips?: ClipRequest[] };
  try {
    body = (await req.json()) as { videoId?: string; clips?: ClipRequest[] };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const videoId = (body.videoId ?? "").trim();
  const clips = Array.isArray(body.clips) ? body.clips : [];
  if (!videoId) return NextResponse.json({ error: "missing_video_id" }, { status: 400 });
  if (clips.length === 0) return NextResponse.json({ error: "no_clips" }, { status: 400 });
  if (clips.length > 30) return NextResponse.json({ error: "too_many_clips" }, { status: 400 });

  const out = await cutClips(videoId, clips);
  return NextResponse.json(out);
}
