import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

/**
 * Text-to-speech provider abstraction.
 * Currently uses Microsoft Edge's Read Aloud API via msedge-tts (no key,
 * websocket-based). Swap the guts of this file to replace the provider
 * without touching consumers.
 */

export type TtsVoice = string; // e.g. "en-US-GuyNeural"

export type TtsOptions = {
  /** Voice short-name (see MsEdgeTTS voices list). */
  voice: TtsVoice;
  /**
   * Prosody rate — pct string like "-5%", "+10%". Default (documentary read):
   * "-5%". Edge is picky about the format; keep it as a signed percentage.
   */
  rate?: string;
  /** Prosody pitch — e.g. "+0Hz". */
  pitch?: string;
};

/** Synthesize `text` and return an MP3 buffer. */
export async function synthesizeMp3(
  text: string,
  opts: TtsOptions,
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  // 96kbps mono MP3 is a good documentary-narration quality / size tradeoff.
  await tts.setMetadata(
    opts.voice,
    OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
  );
  const { audioStream } = tts.toStream(text, {
    rate: opts.rate ?? "-5%",
    pitch: opts.pitch ?? "+0Hz",
  });
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    audioStream.on("close", () => resolve());
    audioStream.on("end", () => resolve());
    audioStream.on("error", (e: Error) => reject(e));
    // Belt-and-suspenders: kill any hanging websocket.
    setTimeout(() => reject(new Error("tts_timeout")), 20_000);
  });
  return Buffer.concat(chunks);
}
