import { listItems, type WireItemRow } from "@/lib/wire/db";
import type { WireCategory } from "@/lib/wire/sources";
import { Header } from "../_components/Header";
import { WireDashboard, type WireWindow } from "./_components/WireDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CATEGORIES: Array<WireCategory | "all"> = [
  "all",
  "markets",
  "wealth",
  "fintech",
  "tech",
  "predictions",
  "culture",
];

function parseCategory(v: string | undefined): WireCategory | "all" {
  return CATEGORIES.includes(v as WireCategory | "all")
    ? (v as WireCategory | "all")
    : "all";
}

function parseWindow(v: string | undefined): WireWindow {
  return v === "3d" ? "3d" : "1d";
}

export default async function WirePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; win?: string; q?: string }>;
}) {
  const params = await searchParams;
  const category = parseCategory(params.cat);
  const window: WireWindow = parseWindow(params.win);
  const text = (params.q ?? "").trim();

  const rows: WireItemRow[] = await listItems({
    category,
    sinceHours: window === "3d" ? 72 : 24,
    text: text || undefined,
  });

  return (
    <div className="flex min-h-screen flex-col bg-ds-surface">
      <Header />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="type-headline-md">The Wire</h1>
          <span className="type-label-sm text-ds-on-surface-muted">
            {rows.length} items
          </span>
        </div>
        <WireDashboard
          rows={rows}
          category={category}
          window={window}
          text={text}
          categories={CATEGORIES}
        />
      </main>
    </div>
  );
}
