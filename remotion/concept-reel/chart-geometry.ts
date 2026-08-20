/**
 * Shared chart geometry — the coordinate contract between the SVG overlay
 * (Explainer.tsx) and the TV canvas (TvChartLayer.tsx). Both must use these
 * exact pixel bounds so overlays (markers, zones, lines) align with the
 * underlying chart.
 */
export const CHART_TOP = 480;
export const CHART_HEIGHT = 900;
export const CHART_LEFT = 130;
export const CHART_RIGHT = 940;
export const CHART_WIDTH = CHART_RIGHT - CHART_LEFT;

/** Bottom axis strip reserved inside the chart rect so the SVG marker's
 * priceMin doesn't collide with the TV chart's time axis labels. */
export const TV_TIME_AXIS_HEIGHT = 26;
