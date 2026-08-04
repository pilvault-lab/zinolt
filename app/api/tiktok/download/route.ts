import { NextResponse } from "next/server";
import { downloadTikTok } from "@/lib/tiktok/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "missing_url" }, { status: 400 });

  const res = await downloadTikTok(url);
  if ("error" in res) {
    return NextResponse.json(res, { status: 502 });
  }
  return NextResponse.json({
    videoId: res.videoId,
    title: res.title,
    filename: res.filename,
    downloadUrl: `/api/tiktok/file?id=${encodeURIComponent(res.videoId)}`,
  });
}
