import { type NextRequest, NextResponse } from "next/server";
import { newJobId } from "@/lib/media-workspace";
import {
  putStatusBlob,
  readStatusBlob,
  startReelSafeSandbox,
} from "@/lib/reelsafe-sandbox";
import { DEFAULT_CONFIG, type WatermarkCorner } from "@/lib/reelsafe-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BROLLS = 10;
const CORNERS: readonly WatermarkCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

type SubmitBody = {
  sourceUrl?: unknown;
  brollUrls?: unknown;
  watermarkUrl?: unknown;
  corner?: unknown;
  speed?: unknown;
};

/** POST JSON { sourceUrl, brollUrls[], watermarkUrl?, corner, speed }
 *  → { jobId }. Files are pre-uploaded by the client directly to Vercel Blob
 *  via /api/reel-safe/upload's signed token. This route only handles small
 *  JSON payloads and spawns a Sandbox VM to do the ffmpeg work. */
export async function POST(req: NextRequest) {
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
  if (!isBlobUrl(sourceUrl)) {
    return NextResponse.json(
      { error: "missing_source", message: "Provide sourceUrl from a Vercel Blob upload." },
      { status: 400 },
    );
  }

  const brollUrlsRaw = Array.isArray(body.brollUrls) ? body.brollUrls : [];
  if (brollUrlsRaw.length > MAX_BROLLS) {
    return NextResponse.json(
      { error: "too_many_brolls", message: `Max ${MAX_BROLLS} b-roll clips per submission.` },
      { status: 400 },
    );
  }
  const brollUrls: string[] = [];
  for (const u of brollUrlsRaw) {
    if (typeof u !== "string" || !isBlobUrl(u)) {
      return NextResponse.json(
        { error: "invalid_broll", message: "All b-roll URLs must be Vercel Blob URLs." },
        { status: 400 },
      );
    }
    brollUrls.push(u);
  }

  const watermarkUrl =
    typeof body.watermarkUrl === "string" && body.watermarkUrl.length > 0
      ? body.watermarkUrl
      : null;
  if (watermarkUrl && !isBlobUrl(watermarkUrl)) {
    return NextResponse.json(
      { error: "invalid_watermark", message: "watermarkUrl must be a Vercel Blob URL." },
      { status: 400 },
    );
  }

  const cornerRaw = typeof body.corner === "string" ? body.corner : "top-right";
  const corner: WatermarkCorner = CORNERS.includes(cornerRaw as WatermarkCorner)
    ? (cornerRaw as WatermarkCorner)
    : "top-right";
  const speedRaw = Number(body.speed ?? DEFAULT_CONFIG.speed);
  const speed = Number.isFinite(speedRaw) && speedRaw > 0.5 && speedRaw < 2.0
    ? speedRaw
    : DEFAULT_CONFIG.speed;

  const jobId = newJobId();
  const config = { ...DEFAULT_CONFIG, watermarkCorner: corner, speed };

  // Seed status so an immediate GET doesn't 404 while the sandbox spins up.
  await putStatusBlob(jobId, { state: "queued", progress: 0 });

  try {
    await startReelSafeSandbox({
      jobId,
      sourceUrl,
      brollUrls,
      watermarkUrl,
      config,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Best-effort surface the failure via the status blob so the client's
    // poll picks it up instead of hanging on "queued".
    await putStatusBlob(jobId, { state: "error", progress: 0, error: msg }).catch(() => {});
    return NextResponse.json(
      { error: "sandbox_start_failed", message: msg },
      { status: 500 },
    );
  }

  return NextResponse.json({ jobId });
}

/** GET ?jobId=X — current status. Returns { state: 'done', result } when the
 *  sandbox finishes. Reads from the status blob the sandbox is updating. */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "missing_jobId" }, { status: 400 });
  }
  let status;
  try {
    status = await readStatusBlob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "status_fetch_failed", message: msg }, { status: 500 });
  }
  if (!status) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(status);
}

function isBlobUrl(u: string): boolean {
  // Vercel Blob public URLs live under <storeId>.public.blob.vercel-storage.com.
  // Accepting any https URL under that domain avoids hard-coding the store id.
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}
