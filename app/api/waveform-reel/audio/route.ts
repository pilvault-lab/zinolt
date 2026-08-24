import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { ingestUpload, ingestYouTube } from "@/lib/waveform-reel/ingest";
import { runFetchAudioSandbox, sandboxAvailable } from "@/lib/waveform-reel/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    // Any uncaught throw (e.g. spawn ENOENT when yt-dlp is missing on
    // serverless) becomes a readable 502 instead of a raw 500.
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `ingest_crashed: ${msg.slice(0, 300)}` },
      { status: 502 },
    );
  }
}

async function handle(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "invalid_form" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing_file" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const res = await ingestUpload(buf, file.name || "audio.bin");
    return NextResponse.json({
      audioUrl: `/api/waveform-reel/serve?key=${encodeURIComponent(res.key)}`,
      key: res.key,
      mime: res.mime,
      ext: res.ext,
      source: "upload",
      name: file.name,
    });
  }

  let body: { url?: string; blobUrl?: string; name?: string };
  try {
    body = (await req.json()) as {
      url?: string;
      blobUrl?: string;
      name?: string;
    };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Direct-Blob upload already landed on the client side. Nothing to do
  // server-side — the browser decodes straight from the Blob URL. Round-trip
  // exists so the client's ingest machinery stays symmetric with URL fetch.
  if (body.blobUrl) {
    return NextResponse.json({
      audioUrl: body.blobUrl,
      key: `blob-${Date.now().toString(36)}`,
      source: "upload",
      name: body.name ?? "audio",
    });
  }

  const url = (body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "missing_url" }, { status: 400 });

  // Deployed Vercel: no yt-dlp in the serverless runtime. Spawn a Firecracker
  // microVM via Vercel Sandbox, install yt-dlp inside, download bestaudio,
  // upload to Blob, return the public Blob URL. Same pattern frame-grab uses.
  if (sandboxAvailable()) {
    const jobId = `wr-${Date.now()}-${randomBytes(3).toString("hex")}`;
    const res = await runFetchAudioSandbox({ jobId, url });
    if ("error" in res) {
      return NextResponse.json({ error: res.error }, { status: 502 });
    }
    return NextResponse.json({
      audioUrl: res.blobUrl,
      key: `blob-${res.pathname}`,
      mime: res.mime,
      ext: res.ext,
      source: "youtube",
      title: res.title,
      channel: res.channel,
    });
  }

  // Local dev (or any env without Vercel Sandbox creds): use local yt-dlp.
  const res = await ingestYouTube(url);
  if ("error" in res) {
    return NextResponse.json(res, { status: 502 });
  }
  return NextResponse.json({
    audioUrl: `/api/waveform-reel/serve?key=${encodeURIComponent(res.key)}`,
    key: res.key,
    mime: res.mime,
    ext: res.ext,
    source: "youtube",
    title: res.title,
    channel: res.channel,
  });
}
