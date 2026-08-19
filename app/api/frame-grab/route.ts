import { NextResponse } from "next/server";
import { extractFrames, type FrameMode, type WindowSpec } from "@/lib/frame-grab/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: {
    source?: string;
    url?: string;
    mode?: string;
    cropOffsetX?: number;
    intervalSec?: number;
    clipDurationSec?: number;
    windows?: Array<{ startSec?: number; count?: number }>;
    moments?: number[];
    startSec?: number;
    count?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const source = (body.source ?? body.url ?? "").trim();
  if (!source) return NextResponse.json({ error: "missing_source" }, { status: 400 });

  const mode: FrameMode = body.mode === "letterboxed" ? "letterboxed" : "full-bleed";
  const cropOffsetX = Math.max(0, Math.min(1, Number(body.cropOffsetX ?? 0.5)));
  const intervalSec = Number(body.intervalSec ?? 0.5);
  const clipDurationSec = Math.max(
    0.05,
    Math.min(10, Number(body.clipDurationSec ?? 0.5)),
  );

  const moments =
    Array.isArray(body.moments) && body.moments.length > 0
      ? body.moments.map((m) => Math.max(0, Number(m))).filter((m) => isFinite(m))
      : undefined;

  let windows: WindowSpec[] | undefined;
  if (!moments) {
    if (Array.isArray(body.windows) && body.windows.length > 0) {
      windows = body.windows.map((w) => ({
        startSec: Math.max(0, Number(w.startSec ?? 0)),
        count: Math.max(1, Math.min(120, Math.floor(Number(w.count ?? 30)))),
      }));
    } else {
      windows = [
        {
          startSec: Math.max(0, Number(body.startSec ?? 0)),
          count: Math.max(1, Math.min(120, Math.floor(Number(body.count ?? 30)))),
        },
      ];
    }
  }

  const res = await extractFrames({
    source,
    mode,
    cropOffsetX,
    intervalSec,
    clipDurationSec,
    windows,
    moments,
  });
  if ("error" in res) return NextResponse.json(res, { status: 502 });
  return NextResponse.json(res);
}
