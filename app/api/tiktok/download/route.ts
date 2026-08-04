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

  let res: Awaited<ReturnType<typeof downloadTikTok>>;
  try {
    res = await downloadTikTok(url);
  } catch (e) {
    return NextResponse.json(
      { error: `internal_error: ${String(e)}` },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  if ("error" in res) {
    return NextResponse.json(res, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    {
      videoId: res.videoId,
      title: res.title,
      filename: res.filename,
      downloadUrl: `/api/tiktok/file?id=${encodeURIComponent(res.videoId)}`,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
