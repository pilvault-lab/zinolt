import { NextResponse } from "next/server";
import { ingestUpload, ingestYouTube } from "@/lib/waveform-reel/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB — a longer video track fits.

export async function POST(req: Request) {
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

  // Client already uploaded direct-to-Blob and just wants us to acknowledge
  // the registration. Nothing to do server-side — the browser can decode
  // straight from the public Blob URL. Round-trip keeps the client's ingest
  // machinery symmetric with the YouTube flow.
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
