import { promises as fs } from "node:fs";
import { type NextRequest, NextResponse } from "next/server";
import { requireFfmpeg, requireFfprobe } from "@/lib/media-tools";
import {
  REELSAFE_FILES,
  ensureJobDir,
  jobPath,
  newJobId,
  sweepOldJobs,
} from "@/lib/media-workspace";
import {
  getActiveJob,
  readStatus,
  startReelSafe,
  writeStatus,
} from "@/lib/reelsafe-pipeline";
import { DEFAULT_CONFIG, type WatermarkCorner } from "@/lib/reelsafe-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MAIN_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_BROLL_BYTES = 100 * 1024 * 1024; // 100 MB per clip
const MAX_WATERMARK_BYTES = 5 * 1024 * 1024;
const MAX_BROLLS = 10;
const CORNERS: readonly WatermarkCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

/** POST multipart/form-data { source, broll[], watermark?, corner?, speed? }
 *  → { jobId }. Client polls GET for progress + result. */
export async function POST(req: NextRequest) {
  try {
    await requireFfmpeg();
    await requireFfprobe();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "missing_tool", message: msg }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const source = form.get("source");
  if (!(source instanceof File) || source.size === 0) {
    return NextResponse.json({ error: "missing_source" }, { status: 400 });
  }
  if (source.size > MAX_MAIN_BYTES) {
    return NextResponse.json({ error: "source_too_large" }, { status: 413 });
  }

  const brolls: File[] = [];
  for (const val of form.getAll("broll")) {
    if (val instanceof File && val.size > 0) brolls.push(val);
  }
  if (brolls.length > MAX_BROLLS) {
    return NextResponse.json(
      { error: "too_many_brolls", message: `Max ${MAX_BROLLS} b-roll clips per submission.` },
      { status: 400 },
    );
  }
  for (const b of brolls) {
    if (b.size > MAX_BROLL_BYTES) {
      return NextResponse.json({ error: "broll_too_large" }, { status: 413 });
    }
  }

  const watermark = form.get("watermark");
  let watermarkFile: File | null = null;
  if (watermark instanceof File && watermark.size > 0) {
    if (watermark.size > MAX_WATERMARK_BYTES) {
      return NextResponse.json({ error: "watermark_too_large" }, { status: 413 });
    }
    if (!/\.png$/i.test(watermark.name)) {
      // v1: PNG only. SVG rasterization needs an extra dep (sharp/rsvg) that
      // isn't installed here — surface a clear error rather than silently fail.
      return NextResponse.json(
        {
          error: "watermark_not_png",
          message: "Watermark must be a PNG for now (SVG support is coming).",
        },
        { status: 400 },
      );
    }
    watermarkFile = watermark;
  }

  const cornerRaw = String(form.get("corner") ?? "top-right");
  const corner: WatermarkCorner = CORNERS.includes(cornerRaw as WatermarkCorner)
    ? (cornerRaw as WatermarkCorner)
    : "top-right";
  const speedRaw = Number(form.get("speed") ?? DEFAULT_CONFIG.speed);
  const speed = Number.isFinite(speedRaw) && speedRaw > 0.5 && speedRaw < 2.0
    ? speedRaw
    : DEFAULT_CONFIG.speed;

  const jobId = newJobId();
  await ensureJobDir(jobId);

  // Persist all uploads to disk before starting the pipeline. Keeps the API
  // handler stateless and lets the worker run entirely on filesystem inputs.
  await saveFile(source, jobPath(jobId, REELSAFE_FILES.source));
  for (let i = 0; i < brolls.length; i += 1) {
    const raw = jobPath(jobId, `broll-${i.toString().padStart(2, "0")}-raw.mp4`);
    await saveFile(brolls[i], raw);
  }
  if (watermarkFile) {
    await saveFile(watermarkFile, jobPath(jobId, REELSAFE_FILES.watermark));
  }

  // Best-effort background sweep of old jobs — never blocks.
  void sweepOldJobs().catch(() => {});

  // Seed status so an immediate GET doesn't 404.
  await writeStatus(jobId, { state: "queued", progress: 0 });

  const config = { ...DEFAULT_CONFIG, watermarkCorner: corner, speed };
  // Fire-and-forget — worker writes status.json + errors go to error state.
  startReelSafe(jobId, brolls.length, config).catch(() => {});

  return NextResponse.json({ jobId });
}

/** GET ?jobId=X — current status. Returns full result on state=done. */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "missing_jobId" }, { status: 400 });
  const active = getActiveJob(jobId);
  const status = await readStatus(jobId);
  if (!status && !active) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(status);
}

async function saveFile(file: File, dest: string): Promise<void> {
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(dest, buf);
}
