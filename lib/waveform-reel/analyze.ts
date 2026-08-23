/**
 * Client-side deterministic audio analysis for WaveformReel.
 *
 * Decodes an audio (or audio track from a video) URL, computes per-frame
 * amplitude (RMS) and per-frame log-spaced sub-band energies, and returns
 * arrays keyed to frame number so the same input always produces the same
 * output — which is what makes the visualizer render identically in the
 * live Player and in the headless MP4 export.
 */

export const WR_NUM_BINS = 32;
/** DFT window in samples. 1024 @ 44.1kHz ≈ 23ms — matches typical AnalyserNode. */
const WINDOW_SAMPLES = 1024;
/** Lowest / highest analyzer center-freq for the log-spaced band ladder. */
const F_LOW = 60;
const F_HIGH = 8000;

export type AudioAnalysis = {
  fps: number;
  totalFrames: number;
  durationSec: number;
  sampleRate: number;
  /** RMS 0..1 per frame — raw. */
  amp: Float32Array;
  /** Attack-fast / release-slow envelope of `amp`. Feels percussive. */
  ampEnv: Float32Array;
  /** Row-major [frame * numBins + bin], each 0..1 magnitude — raw. */
  bins: Float32Array;
  /** Attack/release-enveloped bins (same shape as bins). */
  binsEnv: Float32Array;
  /** Bass-band (~60-200Hz) enveloped amplitude — drives the global pulse. */
  bassEnv: Float32Array;
  numBins: number;
};

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!sharedCtx) {
    const AC =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("Web Audio API not supported in this browser");
    sharedCtx = new AC();
  }
  return sharedCtx;
}

export async function fetchAndDecode(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch_audio_${res.status}`);
  const buf = await res.arrayBuffer();
  const ctx = getCtx();
  // Some Safari versions still want the callback form; the promise form is
  // standard everywhere else.
  return await new Promise<AudioBuffer>((resolve, reject) => {
    ctx.decodeAudioData(buf.slice(0), resolve, reject);
  });
}

/**
 * Down-mix to mono in a new Float32Array. Reads once per channel, writes once.
 */
function toMono(audio: AudioBuffer): Float32Array {
  if (audio.numberOfChannels === 1) {
    return audio.getChannelData(0).slice();
  }
  const len = audio.length;
  const out = new Float32Array(len);
  const chans = audio.numberOfChannels;
  for (let c = 0; c < chans; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i];
  }
  const inv = 1 / chans;
  for (let i = 0; i < len; i++) out[i] *= inv;
  return out;
}

/** Log-spaced center frequencies (Hz) for the K bins. */
function centerFreqs(numBins: number, sampleRate: number): Float32Array {
  const nyq = sampleRate / 2;
  const hi = Math.min(F_HIGH, nyq * 0.95);
  const logLo = Math.log(F_LOW);
  const logHi = Math.log(hi);
  const out = new Float32Array(numBins);
  for (let k = 0; k < numBins; k++) {
    out[k] = Math.exp(logLo + (k / (numBins - 1)) * (logHi - logLo));
  }
  return out;
}

/**
 * Analyze mono samples: for each frame at `fps`, compute RMS over that frame's
 * sample span, plus a K-bin log-spaced spectral magnitude via direct DFT over
 * a Hann-windowed slice centered on the frame midpoint.
 */
export function analyzeMono(
  mono: Float32Array,
  sampleRate: number,
  fps: number,
  {
    trimStartSec = 0,
    trimEndSec,
    numBins = WR_NUM_BINS,
  }: { trimStartSec?: number; trimEndSec?: number; numBins?: number } = {},
): AudioAnalysis {
  const totalSec = mono.length / sampleRate;
  const startSec = Math.max(0, trimStartSec);
  const endSec = Math.min(totalSec, trimEndSec ?? totalSec);
  const durationSec = Math.max(0, endSec - startSec);
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));
  const amp = new Float32Array(totalFrames);
  const bins = new Float32Array(totalFrames * numBins);
  const startSample = Math.floor(startSec * sampleRate);

  // Precompute Hann window and per-bin sin/cos tables for DFT.
  const N = WINDOW_SAMPLES;
  const half = N / 2;
  const hann = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  }
  const freqs = centerFreqs(numBins, sampleRate);
  const cosTab = new Float32Array(numBins * N);
  const sinTab = new Float32Array(numBins * N);
  for (let k = 0; k < numBins; k++) {
    const omega = (2 * Math.PI * freqs[k]) / sampleRate;
    for (let n = 0; n < N; n++) {
      cosTab[k * N + n] = Math.cos(omega * n);
      sinTab[k * N + n] = Math.sin(omega * n);
    }
  }

  const samplesPerFrame = sampleRate / fps;
  // Loudness normalization: track peak RMS and peak bin magnitude so we
  // return 0..1 values regardless of source loudness. Two-pass would be
  // cleaner but this single-pass with a running-max normalized at the end
  // is fine.
  let maxAmp = 1e-6;
  let maxBin = 1e-6;

  for (let f = 0; f < totalFrames; f++) {
    const centerSample = startSample + Math.floor((f + 0.5) * samplesPerFrame);
    // Frame-window RMS: window of one frame's worth of samples.
    const s0 = Math.max(0, centerSample - Math.floor(samplesPerFrame / 2));
    const s1 = Math.min(mono.length, s0 + Math.round(samplesPerFrame));
    let sq = 0;
    for (let i = s0; i < s1; i++) sq += mono[i] * mono[i];
    const rms = Math.sqrt(sq / Math.max(1, s1 - s0));
    amp[f] = rms;
    if (rms > maxAmp) maxAmp = rms;

    // DFT bins: 1024-sample Hann-windowed slice centered on the frame midpoint.
    const w0 = centerSample - half;
    for (let k = 0; k < numBins; k++) {
      let re = 0;
      let im = 0;
      const cOff = k * N;
      for (let n = 0; n < N; n++) {
        const idx = w0 + n;
        if (idx < 0 || idx >= mono.length) continue;
        const s = mono[idx] * hann[n];
        re += s * cosTab[cOff + n];
        im -= s * sinTab[cOff + n];
      }
      const mag = Math.sqrt(re * re + im * im) / N;
      bins[f * numBins + k] = mag;
      if (mag > maxBin) maxBin = mag;
    }
  }

  // Normalize to 0..1.
  const invAmp = 1 / maxAmp;
  for (let i = 0; i < amp.length; i++) amp[i] = Math.min(1, amp[i] * invAmp);
  const invBin = 1 / maxBin;
  for (let i = 0; i < bins.length; i++) bins[i] = Math.min(1, bins[i] * invBin);

  // Attack-fast/release-slow envelopes. Attack ~= 25ms, release ~= 220ms —
  // reads as "punchy but doesn't jitter". Values in per-frame smoothing
  // coefficients: alpha = 1 - exp(-1 / (tauSec * fps)).
  const attackAlpha = 1 - Math.exp(-1 / (0.025 * fps));
  const releaseAlpha = 1 - Math.exp(-1 / (0.22 * fps));
  const ampEnv = envelopeMono(amp, attackAlpha, releaseAlpha);
  const binsEnv = envelopeMulti(bins, numBins, attackAlpha, releaseAlpha);

  // Bass-band envelope: mean of the bottom 4 log-spaced bins (roughly 60-200Hz).
  const bassBins = Math.min(4, numBins);
  const bassRaw = new Float32Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    let s = 0;
    for (let k = 0; k < bassBins; k++) s += bins[f * numBins + k];
    bassRaw[f] = s / bassBins;
  }
  // Bass gets a snappier attack (~15ms) so kicks pop.
  const bassEnv = envelopeMono(
    bassRaw,
    1 - Math.exp(-1 / (0.015 * fps)),
    1 - Math.exp(-1 / (0.18 * fps)),
  );

  return {
    fps,
    totalFrames,
    durationSec,
    sampleRate,
    amp,
    ampEnv,
    bins,
    binsEnv,
    bassEnv,
    numBins,
  };
}

/** Attack-release follower over a 1D signal. Vectorized single pass. */
function envelopeMono(
  src: Float32Array,
  attack: number,
  release: number,
): Float32Array {
  const out = new Float32Array(src.length);
  let v = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    v = x > v ? v + (x - v) * attack : v + (x - v) * release;
    out[i] = v;
  }
  return out;
}

/** Attack-release follower across an interleaved [frame * K + k] matrix. */
function envelopeMulti(
  src: Float32Array,
  stride: number,
  attack: number,
  release: number,
): Float32Array {
  const out = new Float32Array(src.length);
  const state = new Float32Array(stride);
  const frames = src.length / stride;
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < stride; k++) {
      const x = src[f * stride + k];
      const v = state[k];
      state[k] = x > v ? v + (x - v) * attack : v + (x - v) * release;
      out[f * stride + k] = state[k];
    }
  }
  return out;
}

export async function analyzeAudioUrl(
  url: string,
  fps: number,
  opts?: { trimStartSec?: number; trimEndSec?: number; numBins?: number },
): Promise<AudioAnalysis> {
  const audio = await fetchAndDecode(url);
  const mono = toMono(audio);
  return analyzeMono(mono, audio.sampleRate, fps, opts);
}

/** Serialize the analysis into a JSON-safe shape for Remotion inputProps. */
export type SerializedAnalysis = {
  fps: number;
  totalFrames: number;
  durationSec: number;
  sampleRate: number;
  numBins: number;
  /** Base64 of Float32Array bytes — smaller than a JSON array of numbers. */
  ampB64: string;
  ampEnvB64: string;
  binsB64: string;
  binsEnvB64: string;
  bassEnvB64: string;
};

export function serializeAnalysis(a: AudioAnalysis): SerializedAnalysis {
  return {
    fps: a.fps,
    totalFrames: a.totalFrames,
    durationSec: a.durationSec,
    sampleRate: a.sampleRate,
    numBins: a.numBins,
    ampB64: floatArrToB64(a.amp),
    ampEnvB64: floatArrToB64(a.ampEnv),
    binsB64: floatArrToB64(a.bins),
    binsEnvB64: floatArrToB64(a.binsEnv),
    bassEnvB64: floatArrToB64(a.bassEnv),
  };
}

export function deserializeAnalysis(s: SerializedAnalysis): AudioAnalysis {
  return {
    fps: s.fps,
    totalFrames: s.totalFrames,
    durationSec: s.durationSec,
    sampleRate: s.sampleRate,
    numBins: s.numBins,
    amp: b64ToFloatArr(s.ampB64),
    ampEnv: b64ToFloatArr(s.ampEnvB64),
    bins: b64ToFloatArr(s.binsB64),
    binsEnv: b64ToFloatArr(s.binsEnvB64),
    bassEnv: b64ToFloatArr(s.bassEnvB64),
  };
}

/** Sample a per-frame Float32Array with clamped bounds. */
export function sampleAt(arr: Float32Array, frame: number): number {
  if (frame <= 0) return arr[0] ?? 0;
  if (frame >= arr.length) return arr[arr.length - 1] ?? 0;
  return arr[frame];
}

function floatArrToB64(f: Float32Array): string {
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  if (typeof btoa !== "undefined") return btoa(bin);
  // Node fallback (Remotion server-side).
  return Buffer.from(bin, "binary").toString("base64");
}

function b64ToFloatArr(b64: string): Float32Array {
  let bin: string;
  if (typeof atob !== "undefined") bin = atob(b64);
  else bin = Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Copy so the underlying buffer is aligned for Float32.
  const aligned = new Uint8Array(bytes);
  return new Float32Array(
    aligned.buffer,
    aligned.byteOffset,
    aligned.byteLength / 4,
  );
}

/**
 * Small symmetric blur across `radius` neighbouring frames — O(radius) per
 * call, so cheap enough to run from the composition every frame. Keeps the
 * visualizer motion silky without a stateful pre-pass.
 */
export function blurAt(
  arr: Float32Array,
  frame: number,
  radius: number,
  stride = 1,
  offset = 0,
  totalFrames = arr.length / stride,
): number {
  if (radius <= 0) return arr[frame * stride + offset] ?? 0;
  let sum = 0;
  let w = 0;
  for (let d = -radius; d <= radius; d++) {
    const f = frame + d;
    if (f < 0 || f >= totalFrames) continue;
    const weight = 1 - Math.abs(d) / (radius + 1);
    sum += (arr[f * stride + offset] ?? 0) * weight;
    w += weight;
  }
  return w > 0 ? sum / w : 0;
}
