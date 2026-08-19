import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { synthesizeNarration } from "@/lib/tts";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Brand narrator + audition set. Change DEFAULT_VOICE to lock a new brand voice.
 * Rate ~"-5%" for calm, unhurried explanatory pacing.
 */
export const DEFAULT_VOICE = "en-US-AndrewMultilingualNeural";
export const ALLOWED_VOICES = [
  // Neural (classic Edge)
  "en-US-EricNeural",
  "en-US-ChristopherNeural",
  "en-US-GuyNeural",
  "en-US-JennyNeural",
  "en-US-AriaNeural",
  "en-GB-RyanNeural",
  // Multilingual / Turbo (warmer, more expressive)
  "en-US-AndrewMultilingualNeural",
  "en-US-BrianMultilingualNeural",
  "en-US-AvaMultilingualNeural",
  "en-US-EmmaMultilingualNeural",
] as const;

// Was 1200 (~90s narration). Bumped now that we upload to Blob instead of
// base64-inlining in the JSON response — the mobile OOM/parse-stall was the
// real cap, not the text size itself.
const MAX_TEXT_CHARS = 4000;

function sanitize(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: Request) {
  let body: { text?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const text = (body.text ?? "").trim().slice(0, MAX_TEXT_CHARS);
  if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });

  const voice = (ALLOWED_VOICES as readonly string[]).includes(body.voice ?? "")
    ? (body.voice as string)
    : DEFAULT_VOICE;

  try {
    const { mp3, words, durationSec } = await synthesizeNarration(sanitize(text), {
      voice,
      rate: "-5%",
    });
    // Upload to Blob and return a proxy URL instead of base64-inlining. Base64
    // in JSON killed mobile at ~1 MB+ (JSON.parse stalled the main thread,
    // huge data URLs OOMed the <audio> element).
    //
    // Store is private, so we can't hand out the raw blob URL — we return a
    // path to /api/concept-reel/narration that streams the mp3 through with
    // the token server-side. Client uses this as <audio src>.
    const key = `concept-reel/narrations/${Date.now()}-${randomBytes(4).toString("hex")}.mp3`;
    await put(key, mp3, {
      access: "private",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      cacheControlMaxAge: 60 * 60 * 24 * 7,
    });
    return NextResponse.json({
      audioUrl: `/api/concept-reel/narration?p=${encodeURIComponent(key)}`,
      words,
      durationSec,
      voice,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "tts_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
