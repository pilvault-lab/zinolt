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

  // Collect ALL candles beats — each contributes its candles to a single
  // shared series, revealed independently based on that beat's word timing.
  // Multiple beats let a concept introduce candles at different narrative
  // moments (e.g. bullish hero first, bearish counter later).
  const candlesBeats = React.useMemo(
    () =>
      script.beats.filter(
        (b): b is Extract<Beat, { op: "candles" }> => b.op === "candles",
      ),
    [script.beats],
  );

  const cfg = script.chart;

  // Init + teardown.
  React.useEffect(() => {
    if (!hostRef.current || !cfg || candlesBeats.length === 0) return;
    const chart = createChart(hostRef.current, {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      layout: {
        background: { color: "transparent" },
        textColor: "rgba(255,255,255,0.75)",
        fontFamily:
          "'Trebuchet MS', 'Helvetica Neue', Helvetica, Arial, sans-serif",
        fontSize: 13,
        // Hide the small "TV" attribution mark bottom-left.
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.18)",
        timeVisible: false,
        secondsVisible: false,
        // No rightOffset / barSpacing — let TV auto-fit the visible time
        // range across the full chart width so candle x positions match
        // the SVG Projector exactly (both use t/timeSteps * CHART_WIDTH).
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.18)",
        autoScale: false,
        // Zero margins so TV's price scale matches the SVG Projector exactly
        // (both span priceMin..priceMax over the full chart height). This lets
        // the SVG wick overlay in Explainer.tsx sit on top of TV bodies with
        // pixel-perfect alignment.
        scaleMargins: { top: 0, bottom: 0 },
      },
      crosshair: { mode: 0, vertLine: { visible: false }, horzLine: { visible: false } },
      handleScale: false,
      handleScroll: false,
    });

    const series = chart.addSeries(CandlestickSeries, {
      // Classic TradingView palette: teal / soft red — not our brand green.
      upColor: "#26A69A",
      downColor: "#EF5350",
      borderUpColor: "#26A69A",
      borderDownColor: "#EF5350",
      // TV wicks disabled — SVG overlay (Explainer.renderCandles) draws
      // thick wicks on top so they read clearly at preview scale.
      wickVisible: false,
      wickUpColor: "#26A69A",
      wickDownColor: "#EF5350",
      // No live price tag on the right axis — this is a video, not a widget.
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
    const anchorTimeEnd = (1_700_000_000 + (cfg.timeSteps + 1) * 86_400) as unknown as Time;
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
  }, [cfg, candlesBeats]);

  // Per-frame reveal: iterate every candles beat, compute its progressive
  // reveal count, and collect the union into a single time-sorted series.
  React.useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || candlesBeats.length === 0 || words.length === 0) return;
    const baseTime = 1_700_000_000;

    const data: Array<{
      time: Time;
      open: number;
      high: number;
      low: number;
      close: number;
    }> = [];

    for (const beat of candlesBeats) {
      const clamped = Math.max(0, Math.min(beat.atWord, words.length - 1));
      const beatStart = words[clamped].start;
      if (tSec < beatStart) continue;
      const dur = beat.animDurationSec ?? 0.9;
      const rawProgress = (tSec - beatStart) / dur;
      const progress = Math.min(1, Math.max(0, rawProgress));
      const total = beat.candles.length;
      const revealCount = Math.max(1, Math.ceil(progress * total));
      const tStart = beat.tStart ?? 0;
      for (let i = 0; i < revealCount; i++) {
        const c = beat.candles[i];
        data.push({
          time: (baseTime + Math.round((tStart + i) * 86_400)) as unknown as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        });
      }
    }

    // TV requires strictly ascending times; sort in case beats declare
    // out-of-order t values.
    data.sort((a, b) => (a.time as number) - (b.time as number));
    series.setData(data);

    chart.timeScale().setVisibleRange({
      from: baseTime as unknown as Time,
      to: (baseTime + (cfg?.timeSteps ?? 5) * 86_400) as unknown as Time,
    });
  }, [tSec, candlesBeats, cfg, words]);

  if (!cfg || candlesBeats.length === 0) return null;

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
