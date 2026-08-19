import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { runFrameGrabSandbox } from "@/lib/frame-grab-sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  /** Source video Blob URL (from client-upload via /api/frame-grab/upload-token). */
  sourceUrl?: string;
  /** Legacy field, still accepted — must also be a Blob URL now. */
  source?: string;
  mode?: string;
  cropOffsetX?: number;
  intervalSec?: number;
  clipDurationSec?: number;
  windows?: Array<{ startSec?: number; count?: number }>;
  moments?: number[];
};

/** Expand auto-mode windows into a flat list of clip start timestamps. */
function expandWindows(
  windows: Array<{ startSec?: number; count?: number }>,
  intervalSec: number,
): number[] {
  const out: number[] = [];
  for (const w of windows) {
    const start = Math.max(0, Number(w.startSec ?? 0));
    const count = Math.max(1, Math.min(120, Math.floor(Number(w.count ?? 30))));
    for (let i = 0; i < count; i++) out.push(start + i * intervalSec);
  }
  return out;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const sourceUrl = (body.sourceUrl ?? body.source ?? "").trim();
  if (!sourceUrl) return NextResponse.json({ error: "missing_source" }, { status: 400 });
  // Only accept Blob URLs. YouTube/plain URLs would need a separate download
  // path (yt-dlp in the sandbox, or a two-hop through the parent function).
  if (!/^https?:\/\/[^/]*\.public\.blob\.vercel-storage\.com\//i.test(sourceUrl)) {
    return NextResponse.json(
      { error: "source_must_be_blob_url", message: "Upload the file first — YouTube/URL sources aren't wired to the sandbox flow yet." },
      { status: 400 },
    );
  }

  const mode: "full-bleed" | "letterboxed" =
    body.mode === "letterboxed" ? "letterboxed" : "full-bleed";
  const cropOffsetX = Math.max(0, Math.min(1, Number(body.cropOffsetX ?? 0.5)));
  const intervalSec = Number(body.intervalSec ?? 0.5);
  const clipDurationSec = Math.max(
    0.05,
    Math.min(10, Number(body.clipDurationSec ?? 0.5)),
  );

  let moments: number[] = [];
  if (Array.isArray(body.moments) && body.moments.length > 0) {
    moments = body.moments
      .map((m) => Math.max(0, Number(m)))
      .filter((m) => isFinite(m));
  } else if (Array.isArray(body.windows) && body.windows.length > 0) {
    moments = expandWindows(body.windows, intervalSec);
  }
  if (moments.length === 0) {
    return NextResponse.json({ error: "no_moments_or_windows" }, { status: 400 });
  }
  if (moments.length > 500) {
    return NextResponse.json({ error: "too_many_clips" }, { status: 400 });
  }

  const jobId = randomBytes(6).toString("hex");
  const result = await runFrameGrabSandbox({
    jobId,
    sourceUrl,
    mode,
    cropOffsetX,
    clipDurationSec,
    moments,
  });

  if ("error" in result) {
    return NextResponse.json(result, { status: 502 });
  }

  // Match the existing FrameGrabResponse shape the client already expects.
  return NextResponse.json({
    sourceId: jobId,
    title: "Uploaded video",
    channel: "blob",
    durationSec: 0,
    intervalSec,
    clipDurationSec,
    mode,
    cropOffsetX,
    clips: result.clips.map((c) => ({
      src: c.url,
      sec: c.sec,
      durationSec: c.durationSec,
      sizeBytes: c.sizeBytes,
    })),
  });
}
