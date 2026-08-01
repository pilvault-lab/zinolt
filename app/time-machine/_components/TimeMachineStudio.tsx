"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Player } from "@remotion/player";
import {
  canRenderMediaOnWeb,
  renderMediaOnWeb,
} from "@remotion/web-renderer";
import { BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CURATED_TICKERS,
  DEFAULT_AMOUNT,
  DEFAULT_SYMBOL,
  DEFAULT_YEAR,
  TIME_MACHINE_AMOUNTS,
  TIME_MACHINE_YEARS,
  findCuratedTicker,
} from "@/lib/time-machine/tickers";
import type { PortfolioResult } from "@/lib/time-machine/portfolio";
import {
  TimeMachine,
  timeMachineDefaultProps,
  computeTimeMachineTiming,
  TM_CTA_AUDIO_DEFAULT,
  TM_FPS,
  TM_HEIGHT,
  TM_TOTAL_FRAMES,
  TM_WIDTH,
  type TimeMachineProps,
} from "@/remotion/time-machine/TimeMachine";
import { Header } from "../../_components/Header";

const TTS_VOICES = [
  { id: "en-US-ChristopherNeural", label: "Christopher (US)" },
  { id: "en-US-GuyNeural",         label: "Guy (US)" },
  { id: "en-GB-RyanNeural",        label: "Ryan (UK)" },
] as const;
const DEFAULT_VOICE = "en-GB-RyanNeural";

async function measureAudioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new window.Audio();
    a.preload = "metadata";
    const done = (v: number) => {
      a.onloadedmetadata = null;
      a.onerror = null;
      resolve(v);
    };
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => {
      a.onloadedmetadata = null;
      a.onerror = null;
      reject(new Error("audio_metadata_failed"));
    };
    a.src = url;
  });
}

function buildHookSentence(amount: number, tickerName: string, year: number) {
  return `What if you invested $${amount.toLocaleString("en-US")} in ${tickerName} in ${year}?`;
}

const PLAYER_MAX_W = 380;

function slugify(s: string, max: number): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "time-machine"
  );
}

/** Try Web Share Level 2 (files) — used on iOS/Android so the video lands
 *  in Photos. Fall back to a blob download for desktop. */
async function saveOrShare(blob: Blob, filename: string) {
  // renderMediaOnWeb's blob may not carry an explicit MIME type. On iOS
  // Safari, a typed-as-empty blob (or one accidentally tagged audio/*)
  // opens in an inline HTML5 media player showing just the audio track
  // instead of routing to the Share Sheet as a video. Re-wrap with
  // explicit video/mp4 so both Share and anchor-download see a video.
  const videoBlob =
    blob.type === "video/mp4"
      ? blob
      : new Blob([blob], { type: "video/mp4" });
  const file = new File([videoBlob], filename, { type: "video/mp4" });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string }) => Promise<void>;
  };
  if (
    nav.canShare?.({ files: [file] }) &&
    typeof nav.share === "function"
  ) {
    try {
      await nav.share({ files: [file], title: "Time Machine" });
      return;
    } catch {
      // user cancelled or share failed — fall through to download
    }
  }
  const url = URL.createObjectURL(videoBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const TimeMachineStudio: React.FC = () => {
  const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOL);
  const [customSymbol, setCustomSymbol] = useState("");
  const [year, setYear] = useState<number>(DEFAULT_YEAR);
  const [amount, setAmount] = useState<number>(DEFAULT_AMOUNT);

  const [portfolio, setPortfolio] = useState<PortfolioResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string>("");

  // Narration state
  const [narrationEnabled, setNarrationEnabled] = useState(true);
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE);
  const [hookAudioUrl, setHookAudioUrl] = useState<string | null>(null);
  const [hookAudioSec, setHookAudioSec] = useState(0);
  const [narrationLoading, setNarrationLoading] = useState(false);
  const [narrationError, setNarrationError] = useState("");

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState("");

  // Pre-flight the browser's ability to render mp4/h264 at 1080x1920.
  useEffect(() => {
    let cancelled = false;
    canRenderMediaOnWeb({
      container: "mp4",
      videoCodec: "h264",
      width: TM_WIDTH,
      height: TM_HEIGHT,
    })
      .then((r) => {
        if (!cancelled) setCanExport(r.canRender);
      })
      .catch(() => {
        if (!cancelled) setCanExport(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = useCallback(async () => {
    setFetchError("");
    setPortfolio(null);
    const pickedSymbol = symbol === "__custom" ? customSymbol.trim().toUpperCase() : symbol;
    if (!/^[A-Z]{1,6}$/.test(pickedSymbol)) {
      setFetchError("Enter a valid ticker (1–6 letters).");
      return;
    }
    setFetching(true);
    try {
      const res = await fetch(
        `/api/time-machine/data?ticker=${encodeURIComponent(pickedSymbol)}&year=${year}&amount=${amount}`,
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          j.error === "ticker_not_found"
            ? `Couldn't find "${pickedSymbol}" on Yahoo Finance.`
            : j.error === "no_data_for_year"
              ? `No data for ${pickedSymbol} in ${year}.`
              : "Fetch failed. Try again.";
        setFetchError(msg);
        return;
      }
      const data = (await res.json()) as PortfolioResult;
      setPortfolio(data);
    } catch {
      setFetchError("Network error. Try again.");
    } finally {
      setFetching(false);
    }
  }, [symbol, customSymbol, year, amount]);

  // Auto-fetch whenever the ticker / year / amount changes so the preview
  // always reflects the current selection. Debounced so rapid tile-clicks
  // (or typing in the custom-ticker field) collapse into a single request.
  useEffect(() => {
    // Don't fire on an empty custom ticker.
    if (symbol === "__custom" && customSymbol.trim().length === 0) return;
    const t = setTimeout(() => {
      void generate();
    }, 250);
    return () => clearTimeout(t);
  }, [symbol, customSymbol, year, amount, generate]);

  const activeSymbol = symbol === "__custom" ? customSymbol.trim().toUpperCase() : symbol;
  const activeTicker = findCuratedTicker(activeSymbol);
  // Prefer the Yahoo-resolved companyName (works for any ticker, including
  // custom entries not in our curated list). Fall back to the curated
  // display name if we haven't fetched yet, and to the raw symbol as last resort.
  const tickerName = portfolio?.companyName ?? activeTicker?.name ?? activeSymbol;
  const logoUrl = activeTicker?.logo ?? null;

  // Fetch narration whenever inputs change AND narration is on. Clean up
  // stale object URLs. Failures degrade gracefully — no audio, no block.
  useEffect(() => {
    if (!portfolio || !narrationEnabled) {
      // Revoke any existing URL when narration is toggled off.
      if (hookAudioUrl) {
        URL.revokeObjectURL(hookAudioUrl);
        setHookAudioUrl(null);
        setHookAudioSec(0);
      }
      setNarrationError("");
      return;
    }
    let cancelled = false;
    setNarrationLoading(true);
    setNarrationError("");
    const sentence = buildHookSentence(portfolio.amount, tickerName, portfolio.year);
    (async () => {
      try {
        const res = await fetch(
          `/api/tts?text=${encodeURIComponent(sentence)}&voice=${encodeURIComponent(voice)}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        const rawDur = await measureAudioDuration(url).catch(() => 0);
        // Chrome MP3 quirk: some MP3s report Infinity until fully played.
        // Fall back to a byte-rate estimate (96kbps mono).
        const cleanDur = Number.isFinite(rawDur) && rawDur > 0
          ? rawDur
          : (blob.size * 8) / (96 * 1000);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setHookAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setHookAudioSec(cleanDur);
      } catch {
        if (!cancelled) setNarrationError("Narration unavailable — rendering silent.");
      } finally {
        if (!cancelled) setNarrationLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio, tickerName, voice, narrationEnabled]);

  // Effective timing (hook stretches, everything else shifts).
  const timing = useMemo(
    () => computeTimeMachineTiming(narrationEnabled && hookAudioUrl ? hookAudioSec : 0),
    [narrationEnabled, hookAudioUrl, hookAudioSec],
  );

  const inputProps = useMemo<TimeMachineProps>(
    () =>
      portfolio
        ? {
            portfolio,
            tickerName,
            logoUrl,
            forRender: false,
            narrationEnabled,
            hookAudioUrl: narrationEnabled ? hookAudioUrl : null,
            hookDurationSec: hookAudioSec,
            ctaAudioUrl: narrationEnabled ? TM_CTA_AUDIO_DEFAULT : null,
          }
        : timeMachineDefaultProps,
    [portfolio, tickerName, logoUrl, narrationEnabled, hookAudioUrl, hookAudioSec],
  );

  const playVoiceSample = useCallback(async () => {
    const sample = "Hello, this is a sample of the narration voice.";
    try {
      const res = await fetch(
        `/api/tts?text=${encodeURIComponent(sample)}&voice=${encodeURIComponent(voice)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = new window.Audio(url);
      a.play().catch(() => {});
      a.onended = () => URL.revokeObjectURL(url);
    } catch {
      setNarrationError("Sample failed to play.");
    }
  }, [voice]);

  // Player sizing — same pattern as tweet-video studio.
  const [playerDims, setPlayerDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => {
      const maxW = window.innerWidth < 768 ? window.innerWidth - 32 : PLAYER_MAX_W;
      const w = Math.min(maxW, TM_WIDTH);
      setPlayerDims({ w, h: Math.round((w * TM_HEIGHT) / TM_WIDTH) });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const playerW = playerDims.w || Math.min(PLAYER_MAX_W, TM_WIDTH);
  const playerH = playerDims.h || Math.round((playerW * TM_HEIGHT) / TM_WIDTH);

  const handleDownload = useCallback(async () => {
    if (!portfolio) return;
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const totalFrames = timing.totalFrames;
      const narrationOn = narrationEnabled && Boolean(hookAudioUrl);
      const { getBlob } = await renderMediaOnWeb({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        composition: {
          id: "TimeMachine",
          component: TimeMachine,
          durationInFrames: totalFrames,
          fps: TM_FPS,
          width: TM_WIDTH,
          height: TM_HEIGHT,
          defaultProps: timeMachineDefaultProps,
          calculateMetadata: () => ({
            width: TM_WIDTH,
            height: TM_HEIGHT,
            durationInFrames: totalFrames,
            fps: TM_FPS,
          }),
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputProps: { ...inputProps, forRender: true } as any,
        licenseKey: "free-license",
        videoCodec: "h264",
        videoBitrate: "very-high",
        hardwareAcceleration: "prefer-hardware",
        keyframeIntervalInSeconds: 4,
        // Audio: mux with AAC when narration is on (hook + static CTA).
        muted: !narrationOn,
        audioCodec: narrationOn ? "aac" : null,
        audioBitrate: narrationOn ? "high" : undefined,
        delayRenderTimeoutInMilliseconds: 60_000,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await getBlob();
      const filename = `${activeSymbol}_${portfolio.year}_${amount}.mp4`;
      await saveOrShare(blob, filename);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(
        msg && !msg.includes("[object")
          ? msg
          : "Export failed. Try Chrome or Edge on desktop.",
      );
    } finally {
      setIsRendering(false);
    }
  }, [portfolio, inputProps, activeSymbol, amount, timing.totalFrames, narrationEnabled, hookAudioUrl]);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header
        right={
          <Button asChild variant="outline" className="rounded-full font-sans">
            <Link href="/">Change style</Link>
          </Button>
        }
      />

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* LEFT: ticker + controls */}
        <aside
          className="order-3 flex flex-col gap-6 overflow-y-auto p-6 border-t md:order-none md:border-t-0 md:border-r md:w-[380px]"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          <div className="flex flex-col gap-2">
            <label
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Ticker
            </label>
            <div className="grid grid-cols-3 gap-2">
              {CURATED_TICKERS.map((t) => {
                const isActive = symbol === t.symbol;
                return (
                  <button
                    key={t.symbol}
                    type="button"
                    onClick={() => setSymbol(t.symbol)}
                    className="flex flex-col items-center gap-1 rounded-md border p-2 transition-colors"
                    style={{
                      borderColor: isActive ? BRAND.colors.ink : BRAND.colors.grey200,
                      backgroundColor: isActive ? BRAND.colors.ink : "#fff",
                      color: isActive ? BRAND.colors.paper : BRAND.colors.ink,
                    }}
                  >
                    <div
                      className="flex h-9 w-full items-center justify-center overflow-hidden"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={t.logo}
                        alt={t.name}
                        className="max-h-8 w-full object-contain"
                        style={{
                          filter: isActive
                            ? "brightness(0) invert(1)"
                            : "brightness(0)",
                        }}
                      />
                    </div>
                    <span className="font-sans text-[10px] uppercase tracking-wide">
                      {t.symbol}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Or custom ticker
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customSymbol}
                onChange={(e) => {
                  setCustomSymbol(e.target.value);
                  setSymbol("__custom");
                }}
                onFocus={() => setSymbol("__custom")}
                placeholder="e.g. ORCL"
                className="flex-1 rounded-md border px-3 py-2 font-sans text-sm uppercase"
                style={{
                  borderColor:
                    symbol === "__custom"
                      ? BRAND.colors.ink
                      : BRAND.colors.grey200,
                  backgroundColor: "#fff",
                  color: BRAND.colors.ink,
                }}
                maxLength={6}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <label
                className="font-sans text-xs uppercase tracking-wide"
                style={{ color: BRAND.colors.grey500 }}
              >
                Year
              </label>
              <Select
                value={String(year)}
                onValueChange={(v) => setYear(Number(v))}
              >
                <SelectTrigger className="font-sans">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_MACHINE_YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label
                className="font-sans text-xs uppercase tracking-wide"
                style={{ color: BRAND.colors.grey500 }}
              >
                Amount
              </label>
              <Select
                value={String(amount)}
                onValueChange={(v) => setAmount(Number(v))}
              >
                <SelectTrigger className="font-sans">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_MACHINE_AMOUNTS.map((a) => (
                    <SelectItem key={a} value={String(a)}>
                      ${a.toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={generate}
            disabled={fetching}
            className="w-full font-sans"
          >
            {fetching ? "Fetching…" : "Generate"}
          </Button>

          {/* Narration controls — TTS via Edge, optional. */}
          <div className="flex flex-col gap-2 rounded-md border p-3"
               style={{ borderColor: BRAND.colors.grey200 }}>
            <label className="flex items-center justify-between font-sans text-xs uppercase tracking-wide"
                   style={{ color: BRAND.colors.grey500 }}>
              <span>Narration</span>
              <span className="flex items-center gap-2 normal-case tracking-normal"
                    style={{ color: BRAND.colors.ink }}>
                <input
                  type="checkbox"
                  checked={narrationEnabled}
                  onChange={(e) => setNarrationEnabled(e.target.checked)}
                />
                <span>on</span>
              </span>
            </label>
            {narrationEnabled ? (
              <>
                <div className="flex gap-2">
                  <Select value={voice} onValueChange={setVoice}>
                    <SelectTrigger className="flex-1 font-sans text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TTS_VOICES.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={playVoiceSample}
                    className="font-sans text-xs"
                  >
                    Sample
                  </Button>
                </div>
                <p className="font-sans text-[11px] leading-snug"
                   style={{ color: BRAND.colors.grey500 }}>
                  {narrationLoading
                    ? "Generating narration…"
                    : hookAudioUrl
                      ? `Hook audio ready (${hookAudioSec.toFixed(1)}s). CTA is pre-baked.`
                      : "Waiting for data — narration will render once picks load."}
                </p>
                {narrationError ? (
                  <p role="alert" className="font-sans text-[11px]"
                     style={{ color: BRAND.colors.ink }}>
                    {narrationError}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="font-sans text-[11px]" style={{ color: BRAND.colors.grey500 }}>
                Video will render silent.
              </p>
            )}
          </div>

          {fetchError ? (
            <p
              role="alert"
              className="font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.ink }}
            >
              {fetchError}
            </p>
          ) : null}

          {portfolio ? (
            <div
              className="flex flex-col gap-1 rounded-md border p-3 font-sans text-xs"
              style={{
                borderColor: BRAND.colors.grey200,
                color: BRAND.colors.grey500,
              }}
            >
              <div>
                <span>Final value:&nbsp;</span>
                <span
                  className="tabular-nums"
                  style={{ color: BRAND.colors.ink }}
                >
                  ${Math.round(portfolio.finalValue).toLocaleString()}
                </span>
              </div>
              <div>
                <span>Multiple:&nbsp;</span>
                <span
                  className="tabular-nums"
                  style={{ color: BRAND.colors.ink }}
                >
                  {portfolio.multiple.toFixed(portfolio.multiple >= 10 ? 0 : 1)}x
                </span>
              </div>
              <div>Latest: {portfolio.latestDate}</div>
            </div>
          ) : null}
        </aside>

        {/* CENTER: player */}
        <main
          className="order-1 flex flex-1 items-center justify-center p-4 md:order-none md:p-12"
          style={{ backgroundColor: "#1a1a1a" }}
        >
          {portfolio ? (
            <Player
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              component={TimeMachine as any}
              durationInFrames={timing.totalFrames}
              fps={TM_FPS}
              compositionWidth={TM_WIDTH}
              compositionHeight={TM_HEIGHT}
              controls
              loop
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              inputProps={inputProps as any}
              style={{ width: playerW, height: playerH }}
            />
          ) : (
            <div
              className="flex items-center justify-center"
              style={{
                width: playerW,
                height: playerH,
                backgroundColor: "#000",
              }}
            >
              <p
                className="font-sans text-sm"
                style={{ color: BRAND.colors.grey500 }}
              >
                {fetching ? "Fetching data…" : "Pick a ticker to start"}
              </p>
            </div>
          )}
        </main>

        {/* RIGHT: download */}
        <aside
          className="order-2 flex flex-col p-4 border-t md:order-none md:border-t-0 md:border-l md:w-[260px] md:p-6"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          <Button
            onClick={handleDownload}
            disabled={!portfolio || isRendering || canExport === false}
            className="w-full font-sans"
          >
            {isRendering
              ? `Rendering… ${Math.round(progress * 100)}%`
              : "Download video"}
          </Button>
          {canExport === false ? (
            <p
              className="mt-3 font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.grey500 }}
            >
              Exporting needs Chrome or Edge on desktop, or Safari 15+ on mobile.
            </p>
          ) : null}
          {exportError ? (
            <p
              role="alert"
              className="mt-3 font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.ink }}
            >
              {exportError}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
};
