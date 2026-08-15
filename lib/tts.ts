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

/** A single word-boundary event from the TTS engine. Times in seconds. */
export type TtsWord = {
  text: string;
  start: number;
  end: number;
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

/**
 * Synthesize `text` and return both the MP3 and word-level timings.
 * Timings come from Edge's WordBoundary events (ticks of 100ns).
 */
export async function synthesizeNarration(
  text: string,
  opts: TtsOptions,
): Promise<{ mp3: Buffer; words: TtsWord[]; durationSec: number }> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(
    opts.voice,
    OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
    { wordBoundaryEnabled: true, sentenceBoundaryEnabled: false },
  );
  const { audioStream, metadataStream } = tts.toStream(text, {
    rate: opts.rate ?? "-5%",
    pitch: opts.pitch ?? "+0Hz",
  });

  const audioChunks: Buffer[] = [];
  const words: TtsWord[] = [];

  const audioDone = new Promise<void>((resolve, reject) => {
    audioStream.on("data", (c: Buffer) => audioChunks.push(c));
    audioStream.on("close", () => resolve());
    audioStream.on("end", () => resolve());
    audioStream.on("error", (e: Error) => reject(e));
  });

  const metaDone = new Promise<void>((resolve, reject) => {
    if (!metadataStream) {
      resolve();
      return;
    }
    metadataStream.on("data", (chunk: Buffer) => {
      try {
        const parsed = JSON.parse(chunk.toString("utf-8")) as {
          Metadata?: Array<{
            Type?: string;
            Data?: {
              Offset?: number;
              Duration?: number;
              text?: { Text?: string; BoundaryType?: string };
            };
          }>;
        };
        for (const m of parsed.Metadata ?? []) {
          if (m.Type !== "WordBoundary" && m.Data?.text?.BoundaryType !== "WordBoundary") {
            continue;
          }
          const offset = Number(m.Data?.Offset ?? 0);
          const duration = Number(m.Data?.Duration ?? 0);
          const t = m.Data?.text?.Text ?? "";
          if (!t) continue;
          words.push({
            text: t,
            start: offset / 10_000_000,
            end: (offset + duration) / 10_000_000,
          });
        }
      } catch {
        // ignore malformed chunk — websocket sometimes splits payloads
      }
    });
    metadataStream.on("close", () => resolve());
    metadataStream.on("end", () => resolve());
    metadataStream.on("error", (e: Error) => reject(e));
  });

  const timeoutId = setTimeout(() => {
    audioStream.destroy(new Error("tts_timeout"));
    metadataStream?.destroy();
  }, 30_000);

  try {
    await Promise.all([audioDone, metaDone]);
  } finally {
    clearTimeout(timeoutId);
  }

  const mp3 = Buffer.concat(audioChunks);
  words.sort((a, b) => a.start - b.start);
  const durationSec = words.length > 0 ? words[words.length - 1].end : 0;
  return { mp3, words, durationSec };
}
