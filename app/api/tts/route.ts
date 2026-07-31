import { NextResponse } from "next/server";
import { synthesizeMp3 } from "@/lib/tts";

export const runtime = "nodejs";

/** Voice defaults live here — one place to change the brand voice. */
export const DEFAULT_TTS_VOICE = "en-GB-RyanNeural";
export const ALLOWED_TTS_VOICES = [
  "en-US-ChristopherNeural",
  "en-US-GuyNeural",
  "en-GB-RyanNeural",
] as const;

const MAX_TEXT_CHARS = 200;

/** XML-sanitize input — msedge-tts embeds text in an SSML payload. */
function sanitize(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("text") ?? "";
  const voiceRaw = url.searchParams.get("voice") ?? DEFAULT_TTS_VOICE;

  const text = raw.trim().slice(0, MAX_TEXT_CHARS);
  if (!text) {
    return NextResponse.json({ error: "empty_text" }, { status: 400 });
  }
  const voice = (ALLOWED_TTS_VOICES as readonly string[]).includes(voiceRaw)
    ? voiceRaw
    : DEFAULT_TTS_VOICE;

  try {
    const mp3 = await synthesizeMp3(sanitize(text), { voice });
    return new NextResponse(new Uint8Array(mp3), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(mp3.length),
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "tts_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
