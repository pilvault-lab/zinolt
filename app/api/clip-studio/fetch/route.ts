import { NextResponse } from "next/server";
import { fetchYouTube } from "@/lib/clip-studio/youtube";

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

  const res = await fetchYouTube(url);
  if ("error" in res) {
    return NextResponse.json(res, { status: 502 });
  }
  // Don't return the local filesystem path to the client.
  const { videoPath: _videoPath, ...safe } = res;
  void _videoPath;
  return NextResponse.json(safe);
}
