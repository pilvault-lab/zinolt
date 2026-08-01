import { NextResponse } from "next/server";
import { cutClips, type ClipRequest, type CutOptions } from "@/lib/clip-studio/cut";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: {
    videoId?: string;
    clips?: ClipRequest[];
    orientation?: string;
    burnCaptions?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const videoId = (body.videoId ?? "").trim();
  const clips = Array.isArray(body.clips) ? body.clips : [];
  if (!videoId) return NextResponse.json({ error: "missing_video_id" }, { status: 400 });
  if (clips.length === 0) return NextResponse.json({ error: "no_clips" }, { status: 400 });
  if (clips.length > 30) return NextResponse.json({ error: "too_many_clips" }, { status: 400 });

  const orientation =
    body.orientation === "letterboxed" ? "letterboxed" : "full-bleed";
  const burnCaptions = body.burnCaptions !== false;
  const opts: CutOptions = { orientation, burnCaptions };

  const out = await cutClips(videoId, clips, opts);
  return NextResponse.json(out);
}
