"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { WireItemRow } from "@/lib/wire/db";
import type { WireCategory } from "@/lib/wire/sources";

export type WireWindow = "1d" | "3d";

type SyncResult = {
  perSource: Array<{ name: string; fetched: number; new: number; error?: string }>;
  totalNew: number;
  deleted?: number;
};

function fmtRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return "";
  const diff = Date.now() - d;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}

function fmtScore(n: number | null): string {
  if (n == null) return "";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function isTypingElement(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

function buildCarouselHref(row: WireItemRow): string {
  const usp = new URLSearchParams();
  usp.set("title", row.title);
  if (row.category) usp.set("category", row.category);
  if (row.snippet) usp.set("snippet", row.snippet);
  usp.set("url", row.url);
  return `/wire-carousel?${usp.toString()}`;
}

function buildHref(patch: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(patch)) {
    if (v && v.length > 0) usp.set(k, v);
  }
  const qs = usp.toString();
  return qs ? `/wire?${qs}` : "/wire";
}

export const WireDashboard: React.FC<{
  rows: WireItemRow[];
  category: WireCategory | "all";
  window: WireWindow;
  text: string;
  categories: Array<WireCategory | "all">;
}> = ({ rows: initialRows, category, window: win, text, categories }) => {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Client-side mirror of the row set so optimistic star/used/hide feel instant.
  const [rows, setRows] = useState(initialRows);
  useEffect(() => setRows(initialRows), [initialRows]);

  const [focused, setFocused] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [query, setQuery] = useState(text);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const visibleRows = useMemo(() => rows.filter((r) => r.hidden === 0), [rows]);

  useEffect(() => {
    if (focused >= visibleRows.length) {
      setFocused(Math.max(0, visibleRows.length - 1));
    }
  }, [visibleRows.length, focused]);

  // Debounce query updates back into the URL.
  useEffect(() => {
    if (query === text) return;
    const t = setTimeout(() => {
      startTransition(() => {
        router.push(
          buildHref({ cat: category === "all" ? undefined : category, win, q: query }),
        );
      });
    }, 250);
    return () => clearTimeout(t);
  }, [query, text, category, win, router]);

  const pushWith = (patch: Record<string, string | undefined>) => {
    startTransition(() => {
      router.push(
        buildHref({
          cat: category === "all" ? undefined : category,
          win,
          q: query || undefined,
          ...patch,
        }),
      );
    });
  };

  const runSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await fetch("/api/wire/sync", { method: "POST" });
      if (!res.ok) throw new Error(`sync ${res.status}`);
      const json = (await res.json()) as SyncResult;
      setSyncResult(json);
      startTransition(() => router.refresh());
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [router]);

  const toggleFlag = useCallback(
    async (row: WireItemRow, flag: "starred" | "used" | "hidden") => {
      const next: 0 | 1 = row[flag] === 1 ? 0 : 1;
      // Optimistic — flip in local state immediately.
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, [flag]: next } : r)),
      );
      try {
        await fetch("/api/wire/item", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: row.id, flag, value: next }),
        });
      } catch {
        // Revert on failure.
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, [flag]: row[flag] } : r)),
        );
      }
    },
    [],
  );

  // Keyboard: j/k move, s star, u used, h hide, o open, / focus search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (isTypingElement(e.target)) return;
      if (visibleRows.length === 0) return;
      const row = visibleRows[Math.min(focused, visibleRows.length - 1)];
      switch (e.key) {
        case "j":
          e.preventDefault();
          setFocused((f) => Math.min(visibleRows.length - 1, f + 1));
          break;
        case "k":
          e.preventDefault();
          setFocused((f) => Math.max(0, f - 1));
          break;
        case "s":
          e.preventDefault();
          void toggleFlag(row, "starred");
          break;
        case "u":
          e.preventDefault();
          void toggleFlag(row, "used");
          break;
        case "h":
          e.preventDefault();
          void toggleFlag(row, "hidden");
          break;
        case "o":
          e.preventDefault();
          window.open(row.url, "_blank", "noopener,noreferrer");
          break;
      }
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [visibleRows, focused, toggleFlag]);

  // Scroll focused row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${focused}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-ds-border-hairline pb-4">
        <button
          type="button"
          onClick={runSync}
          disabled={syncing}
          className="rounded-md bg-ds-primary px-3 py-1.5 text-sm font-semibold text-ds-on-primary hover:opacity-90 disabled:opacity-60"
        >
          {syncing ? "Syncing…" : "Sync"}
        </button>

        <div className="flex flex-wrap items-center gap-1">
          {categories.map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                onClick={() =>
                  pushWith({ cat: c === "all" ? undefined : c })
                }
                className={[
                  "rounded-full border px-2.5 py-1 text-xs transition",
                  active
                    ? "border-ds-primary bg-ds-primary text-ds-on-primary"
                    : "border-ds-border-hairline text-ds-on-surface-muted hover:bg-[rgba(10,10,10,0.05)]",
                ].join(" ")}
              >
                {c}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-ds-border-hairline p-0.5">
          {(["1d", "3d"] as WireWindow[]).map((w) => {
            const active = w === win;
            return (
              <button
                key={w}
                type="button"
                onClick={() => pushWith({ win: w === "1d" ? undefined : w })}
                className={[
                  "rounded-full px-2.5 py-0.5 text-xs transition",
                  active
                    ? "bg-ds-primary text-ds-on-primary"
                    : "text-ds-on-surface-muted hover:bg-[rgba(10,10,10,0.05)]",
                ].join(" ")}
              >
                {w === "1d" ? "Today" : "Last 3 days"}
              </button>
            );
          })}
        </div>

        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…  ( / )"
          className="ml-auto w-56 rounded-md border border-ds-border-hairline bg-ds-surface-raised px-3 py-1.5 text-sm text-ds-on-surface outline-none focus:border-ds-primary"
        />
      </div>

      {/* Sync result panel */}
      {(syncResult || syncError) && (
        <SyncSummary
          result={syncResult}
          error={syncError}
          onDismiss={() => {
            setSyncResult(null);
            setSyncError(null);
          }}
        />
      )}

      {/* Keyboard hint */}
      <p className="text-xs text-ds-on-surface-muted">
        <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd>{" "}
        move · <kbd className="font-mono">s</kbd> star ·{" "}
        <kbd className="font-mono">u</kbd> used ·{" "}
        <kbd className="font-mono">h</kbd> hide ·{" "}
        <kbd className="font-mono">o</kbd> open ·{" "}
        <kbd className="font-mono">/</kbd> search
      </p>

      {visibleRows.length === 0 ? (
        <div className="rounded-md border border-ds-border-hairline bg-ds-surface-raised p-8 text-center">
          <p className="type-body-md text-ds-on-surface-muted">
            No items. Hit <span className="font-semibold">Sync</span> to pull.
          </p>
        </div>
      ) : (
        <ul
          ref={listRef}
          className="flex flex-col divide-y divide-ds-border-hairline overflow-hidden rounded-md border border-ds-border-hairline bg-ds-surface-raised"
        >
          {visibleRows.map((row, i) => (
            <WireRow
              key={row.id}
              row={row}
              focused={i === focused}
              index={i}
              onFocus={() => setFocused(i)}
              onToggle={(flag) => toggleFlag(row, flag)}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const WireRow: React.FC<{
  row: WireItemRow;
  focused: boolean;
  index: number;
  onFocus: () => void;
  onToggle: (flag: "starred" | "used" | "hidden") => void;
}> = ({ row, focused, index, onFocus, onToggle }) => {
  return (
    <li
      data-idx={index}
      onClick={onFocus}
      className={[
        "grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 px-3 py-2 text-sm transition",
        focused ? "bg-[rgba(10,10,10,0.04)]" : "",
        row.used ? "opacity-50" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-1 text-ds-on-surface-muted">
        <button
          type="button"
          title={row.starred ? "Unstar" : "Star"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle("starred");
          }}
          className="grid h-5 w-5 place-items-center rounded hover:bg-[rgba(10,10,10,0.06)]"
        >
          <span className={row.starred ? "text-ds-on-surface" : ""}>
            {row.starred ? "★" : "☆"}
          </span>
        </button>
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium text-ds-on-surface hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.title}
          </a>
        </div>
        {row.snippet ? (
          <p className="truncate text-xs text-ds-on-surface-muted">
            {row.snippet}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 text-xs text-ds-on-surface-muted">
        <span className="rounded bg-[rgba(10,10,10,0.06)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          {row.source_name}
        </span>
        {row.score != null ? <span>{fmtScore(row.score)}</span> : null}
        <span>{fmtRelative(row.published_at)}</span>
        <a
          href={buildCarouselHref(row)}
          target="_blank"
          rel="noreferrer"
          title="Create carousel"
          onClick={(e) => e.stopPropagation()}
          className="rounded border border-ds-border-hairline px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-[rgba(10,10,10,0.06)]"
        >
          Carousel
        </a>
        <button
          type="button"
          title={row.used ? "Mark unused" : "Mark used"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle("used");
          }}
          className="grid h-5 w-5 place-items-center rounded hover:bg-[rgba(10,10,10,0.08)]"
        >
          {row.used ? "✓" : "○"}
        </button>
        <button
          type="button"
          title="Hide"
          onClick={(e) => {
            e.stopPropagation();
            onToggle("hidden");
          }}
          className="grid h-5 w-5 place-items-center rounded hover:bg-[rgba(10,10,10,0.08)]"
        >
          ×
        </button>
      </div>
    </li>
  );
};

const SyncSummary: React.FC<{
  result: SyncResult | null;
  error: string | null;
  onDismiss: () => void;
}> = ({ result, error, onDismiss }) => {
  const failures = result?.perSource.filter((s) => s.error) ?? [];
  return (
    <div className="rounded-md border border-ds-border-hairline bg-ds-surface-raised p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">
          {error
            ? `Sync failed: ${error}`
            : `${result?.totalNew ?? 0} new item${result?.totalNew === 1 ? "" : "s"}${
                result?.deleted ? ` · ${result.deleted} pruned` : ""
              }`}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-ds-on-surface-muted hover:text-ds-on-surface"
        >
          dismiss
        </button>
      </div>
      {result ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ds-on-surface-muted">
          {result.perSource.map((s) => (
            <span
              key={s.name}
              className={s.error ? "text-red-600" : ""}
              title={s.error}
            >
              {s.name}: {s.error ? "fail" : `${s.new}/${s.fetched}`}
            </span>
          ))}
        </div>
      ) : null}
      {failures.length > 0 ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-red-700">
            {failures.length} failure{failures.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 ml-4 list-disc space-y-0.5">
            {failures.map((f) => (
              <li key={f.name}>
                <span className="font-medium">{f.name}</span> — {f.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
};
