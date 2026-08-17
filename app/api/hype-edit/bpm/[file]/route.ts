import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hype-edit/bpm/{filename}
 *   or /api/hype-edit/bpm/{filename}?custom=1  for tracks under /custom.
 *
 * Reads `{filename-without-ext}.bpm` (plain integer) and returns { bpm }.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ file: string }> },
) {
  const { file } = await ctx.params;
  if (file.includes("/") || file.includes("\\") || file.includes("..")) {
    return NextResponse.json({ error: "bad_file" }, { status: 400 });
  }
  const isCustom = new URL(req.url).searchParams.has("custom");
  const base = file.replace(/\.[^./]+$/, "");
  const dir = isCustom
    ? path.join(process.cwd(), "public", "hype-edit", "audio", "custom")
    : path.join(process.cwd(), "public", "hype-edit", "audio");
  const sidecar = path.join(dir, `${base}.bpm`);
  try {
    const raw = (await readFile(sidecar, "utf8")).trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n < 400) {
      return NextResponse.json({ bpm: n });
    }
  } catch {
    /* fall through */
  }
  return NextResponse.json({ bpm: null });
}
