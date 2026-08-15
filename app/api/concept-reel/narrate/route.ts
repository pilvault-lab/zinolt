import { NextResponse } from "next/server";
import { synthesizeNarration } from "@/lib/tts";

export const runtime = "nodejs";

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

const MAX_TEXT_CHARS = 1200;

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
    const audio = `data:audio/mpeg;base64,${mp3.toString("base64")}`;
    return NextResponse.json({ audio, words, durationSec, voice });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "tts_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
