import React from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { Beat, ConceptScript } from "@/lib/explainer/types";
import type { ConceptReelWord } from "./ConceptReelComposition";
import {
  CHART_LEFT,
  CHART_TOP,
  CHART_WIDTH,
  CHART_HEIGHT,
} from "./chart-geometry";

/**
 * Mounts a lightweight-charts canvas that draws the TradingView-style
 * candles. Positioned to exactly match the shared chart geometry so SVG
 * overlays (marker/zone/hline/line/annotation) drawn by Explainer.tsx
 * remain pixel-aligned with the candles below.
 *
 * The chart's visible price range is forced to script.chart.priceMin/Max
 * via a hidden helper line series with two anchor points — otherwise the
 * TV chart auto-fits to data and the overlay Projector (which uses static
 * priceMin/Max) would drift.
 *
 * Candles reveal progressively based on the current time vs the `candles`
 * beat's word timestamp — matches the SVG-mode reveal cadence.
 */
export const TvChartLayer: React.FC<{
  script: ConceptScript;
  words: ConceptReelWord[];
  tSec: number;
}> = ({ script, words, tSec }) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const anchorRef = React.useRef<ISeriesApi<"Line"> | null>(null);

  // Find the first candles beat — that's our data source. Additional
  // candles beats aren't supported yet (multi-series would need per-beat
  // series management).
  const candlesBeat = React.useMemo(
    () => script.beats.find((b): b is Extract<Beat, { op: "candles" }> => b.op === "candles"),
    [script.beats],
  );

  const cfg = script.chart;

  // Init + teardown.
  React.useEffect(() => {
    if (!hostRef.current || !cfg || !candlesBeat) return;
    const chart = createChart(hostRef.current, {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      layout: {
        background: { color: "transparent" },
        textColor: "rgba(255,255,255,0.62)",
        fontFamily: "'Messina Sans', sans-serif",
        fontSize: 13,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.08)" },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.18)",
        visible: false, // synthetic timestamps — labels aren't meaningful
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.18)",
        autoScale: false,
      },
      crosshair: { mode: 0, vertLine: { visible: false }, horzLine: { visible: false } },
      handleScale: false,
      handleScroll: false,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22C55E",
      downColor: "#EF4444",
      borderUpColor: "#22C55E",
      borderDownColor: "#EF4444",
      wickUpColor: "#22C55E",
      wickDownColor: "#EF4444",
      // Suppress the "last close" dashed line + right-axis highlight — this
      // is a video, not a live trading widget.
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Hidden anchor line — forces price scale to span cfg.priceMin..priceMax
    // so SVG overlays computed via Projector remain aligned.
    const anchor = chart.addSeries(LineSeries, {
      color: "rgba(0,0,0,0)",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const anchorTimeStart = 1_700_000_000 as unknown as Time;
    const anchorTimeEnd = (1_700_000_000 + (cfg.timeSteps + 1) * 60) as unknown as Time;
    anchor.setData([
      { time: anchorTimeStart, value: cfg.priceMin },
      { time: anchorTimeEnd, value: cfg.priceMax },
    ]);

    chartRef.current = chart;
    seriesRef.current = series;
    anchorRef.current = anchor;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      anchorRef.current = null;
    };
  }, [cfg, candlesBeat]);

  // Per-frame reveal: recompute how many candles should be visible.
  React.useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !candlesBeat || words.length === 0) return;
    const clamped = Math.max(0, Math.min(candlesBeat.atWord, words.length - 1));
    const beatStart = words[clamped].start;
    const dur = candlesBeat.animDurationSec ?? 0.9;
    const rawProgress = (tSec - beatStart) / dur;
    const progress = Math.min(1, Math.max(0, rawProgress));
    const total = candlesBeat.candles.length;
    const revealCount = tSec < beatStart ? 0 : Math.max(1, Math.ceil(progress * total));

    const tStart = candlesBeat.tStart ?? 0;
    const baseTime = 1_700_000_000;
    const data = candlesBeat.candles.slice(0, revealCount).map((c, i) => ({
      time: (baseTime + (tStart + i) * 60) as unknown as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(data);

    // Lock the visible time range to the full chart span so candles don't
    // resize as new bars are appended.
    chart.timeScale().setVisibleRange({
      from: baseTime as unknown as Time,
      to: (baseTime + (cfg?.timeSteps ?? 5) * 60) as unknown as Time,
    });
  }, [tSec, candlesBeat, cfg, words]);

  if (!cfg || !candlesBeat) return null;

  return (
    <div
      ref={hostRef}
      style={{
        position: "absolute",
        left: CHART_LEFT,
        top: CHART_TOP,
        width: CHART_WIDTH,
        height: CHART_HEIGHT,
        pointerEvents: "none",
      }}
    />
  );
};
