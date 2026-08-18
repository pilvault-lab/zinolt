import { NextResponse } from "next/server";
import { extractFrames, type FrameMode, type WindowSpec } from "@/lib/frame-grab/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: {
    source?: string;
    url?: string; // legacy alias
    windows?: Array<{ startSec?: number; count?: number }>;
    // legacy single-window fields:
    startSec?: number;
    count?: number;
    intervalSec?: number;
    mode?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const source = (body.source ?? body.url ?? "").trim();
  if (!source) return NextResponse.json({ error: "missing_source" }, { status: 400 });

  const intervalSec = Number(body.intervalSec ?? 0.5);
  const mode: FrameMode = body.mode === "letterboxed" ? "letterboxed" : "full-bleed";

  let windows: WindowSpec[];
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

  const res = await extractFrames({ source, intervalSec, mode, windows });
  if ("error" in res) return NextResponse.json(res, { status: 502 });
  return NextResponse.json(res);
}
