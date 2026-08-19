import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { runFrameGrabSandbox } from "@/lib/frame-grab-sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  /** Blob pathname for the source video (preferred, private-store friendly). */
  sourcePathname?: string;
  /** Legacy: Blob URL. We parse the pathname out of it. */
  sourceUrl?: string;
  /** Legacy alias, still accepted. */
  source?: string;
  mode?: string;
  cropOffsetX?: number;
  intervalSec?: number;
  clipDurationSec?: number;
  windows?: Array<{ startSec?: number; count?: number }>;
  moments?: number[];
};

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

/** Best-effort extract a Blob pathname from a URL. Blob URLs look like
 *  https://<store>.public.blob.vercel-storage.com/<pathname>. */
function pathnameFromBlobUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (!url.hostname.endsWith(".blob.vercel-storage.com")) return null;
    return url.pathname.replace(/^\//, "");
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let sourcePathname = (body.sourcePathname ?? "").trim();
  if (!sourcePathname) {
    const rawSource = (body.sourceUrl ?? body.source ?? "").trim();
    if (rawSource) {
      const derived = pathnameFromBlobUrl(rawSource);
      if (derived) sourcePathname = derived;
    }
  }
  if (!sourcePathname) {
    return NextResponse.json(
      {
        error: "missing_source",
        message:
          "Send { sourcePathname } from a Blob upload or a resolve response. Raw URLs / local paths aren't supported on the sandbox flow.",
      },
      { status: 400 },
    );
  }
  if (!sourcePathname.startsWith("frame-grab/")) {
    return NextResponse.json(
      { error: "bad_source_pathname" },
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
    sourcePathname,
    mode,
    cropOffsetX,
    clipDurationSec,
    moments,
  });

  if ("error" in result) {
    return NextResponse.json(result, { status: 502 });
  }

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
      src: `/api/frame-grab/clip?p=${encodeURIComponent(c.pathname)}`,
      sec: c.sec,
      durationSec: c.durationSec,
      sizeBytes: c.sizeBytes,
    })),
  });
}
