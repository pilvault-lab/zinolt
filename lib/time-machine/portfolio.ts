export type MonthlyPoint = {
  /** ISO YYYY-MM-DD (last trading day of the month, from Stooq). */
  date: string;
  /** Split-adjusted close in USD. */
  close: number;
  /** Portfolio value at this month = shares * close. */
  value: number;
};

export type Milestone = {
  /** Machine key so the composition can style them per-type. */
  kind: "first-2x" | "first-10x" | "biggest-year" | "max-drawdown";
  /** Human label — e.g. "First 2x", "-58% drawdown". */
  label: string;
  /** Point on the series where the annotation anchors. */
  point: MonthlyPoint;
};

export type PortfolioResult = {
  symbol: string;
  year: number;
  amount: number;
  /** Shares purchased at the first close of {year}, split-adjusted. */
  shares: number;
  /** Full monthly series from entry to latest. */
  series: MonthlyPoint[];
  /** Final portfolio value (latest close × shares). */
  finalValue: number;
  /** finalValue / amount, e.g. 27.3. */
  multiple: number;
  /** Up to 4 annotations for the ride. */
  milestones: Milestone[];
  /** Latest data date, for staleness indication. */
  latestDate: string;
  /** Company name from Yahoo search — used when the custom ticker isn't in
   *  the curated list. Optional; falls back to symbol if lookup fails. */
  companyName?: string;
};

/** Parse Stooq monthly CSV. First row is header:
 *  Date,Open,High,Low,Close,Volume
 */
export function parseStooqCsv(csv: string): Array<{ date: string; close: number }> {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const rows: Array<{ date: string; close: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 5) continue;
    const date = cols[0];
    const close = Number(cols[4]);
    if (!date || !Number.isFinite(close)) continue;
    rows.push({ date, close });
  }
  return rows;
}

/** Given the full monthly series and the entry year, build the portfolio
 *  series, compute the final value/multiple, and derive milestones. */
export function buildPortfolio(
  rows: Array<{ date: string; close: number }>,
  symbol: string,
  year: number,
  amount: number,
): PortfolioResult | { error: "no_data_for_year" | "no_data" } {
  if (rows.length === 0) return { error: "no_data" };
  // First close on or after Jan 1 of {year}.
  const entryIdx = rows.findIndex((r) => r.date.slice(0, 4) === String(year));
  if (entryIdx === -1) return { error: "no_data_for_year" };
  const entry = rows[entryIdx];
  const shares = amount / entry.close;

  const series: MonthlyPoint[] = rows.slice(entryIdx).map((r) => ({
    date: r.date,
    close: r.close,
    value: shares * r.close,
  }));

  const finalValue = series[series.length - 1].value;
  const multiple = finalValue / amount;

  const milestones: Milestone[] = [];
  // First 2x
  const p2x = series.find((p) => p.value >= amount * 2);
  if (p2x) milestones.push({ kind: "first-2x", label: "First 2x", point: p2x });
  // First 10x
  const p10x = series.find((p) => p.value >= amount * 10);
  if (p10x) milestones.push({ kind: "first-10x", label: "First 10x", point: p10x });
  // Biggest single-calendar-year jump
  const yearlyEnds = new Map<number, MonthlyPoint>();
  for (const p of series) yearlyEnds.set(Number(p.date.slice(0, 4)), p);
  const years = Array.from(yearlyEnds.keys()).sort((a, b) => a - b);
  let bestYear = { yr: 0, gain: 0, point: series[0] };
  for (let i = 1; i < years.length; i++) {
    const prev = yearlyEnds.get(years[i - 1])!;
    const curr = yearlyEnds.get(years[i])!;
    const gain = curr.value / prev.value - 1;
    if (gain > bestYear.gain) bestYear = { yr: years[i], gain, point: curr };
  }
  if (bestYear.gain > 0.3) {
    milestones.push({
      kind: "biggest-year",
      label: `Best year +${Math.round(bestYear.gain * 100)}%`,
      point: bestYear.point,
    });
  }
  // Max drawdown trough (from peak-to-trough after entry)
  let peak = series[0].value;
  let worst = { dd: 0, point: series[0] };
  for (const p of series) {
    if (p.value > peak) peak = p.value;
    const dd = p.value / peak - 1; // negative
    if (dd < worst.dd) worst = { dd, point: p };
  }
  if (worst.dd < -0.2) {
    milestones.push({
      kind: "max-drawdown",
      label: `${Math.round(worst.dd * 100)}% drawdown`,
      point: worst.point,
    });
  }

  return {
    symbol,
    year,
    amount,
    shares,
    series,
    finalValue,
    multiple,
    milestones,
    latestDate: series[series.length - 1].date,
  };
}
