import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: "empty" }, { status: 400 });

  const id = randomBytes(8).toString("hex");
  const dir = join(tmpdir(), "zinolt-sc");
  mkdirSync(dir, { recursive: true });
  const inp = join(dir, `${id}_in.mp4`);
  const out = join(dir, `${id}_out.mp4`);
  writeFileSync(inp, buf);

  await new Promise<void>((resolve, reject) => {
    // -map_metadata -1  → drop all container metadata
    // -fflags +bitexact  → no encoder timestamp in headers
    // -c copy            → no re-encode, instant
    const child = spawn("ffmpeg", [
      "-y", "-i", inp,
      "-c", "copy",
      "-map_metadata", "-1",
      "-fflags", "+bitexact",
      out,
    ], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
  });

  const result = readFileSync(out);
  try { rmSync(inp); rmSync(out); } catch { /* ignore */ }

  return new NextResponse(result, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": 'attachment; filename="story.mp4"',
    },
  });
}
