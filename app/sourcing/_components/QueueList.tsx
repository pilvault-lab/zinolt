"use client";

import { useEffect, useState, useTransition } from "react";
import type { TweetQueueRow, QueueMediaType } from "@/lib/tweet-queue";
import { approveAndStyle, rejectRow } from "../actions";

const MEDIA_ICON: Record<QueueMediaType, string> = {
  video: "▶",
  gif: "◐",
  photo: "▤",
};

function fmtCount(n: number | null): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function fmtRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
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

export const QueueList: React.FC<{ rows: TweetQueueRow[] }> = ({ rows }) => {
  const [focused, setFocused] = useState(0);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Reset focus if the row list length changes underneath us.
  useEffect(() => {
    if (focused >= rows.length) setFocused(Math.max(0, rows.length - 1));
  }, [rows.length, focused]);

  const runApprove = (id: string) => {
    setPendingRowId(id);
    startTransition(() => {
      approveAndStyle(id).catch(() => setPendingRowId(null));
    });
  };

  const runReject = (id: string) => {
    setPendingRowId(id);
    startTransition(() => {
      rejectRow(id)
        .catch(() => {})
        .finally(() => setPendingRowId(null));
    });
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingElement(e.target)) return;
      if (rows.length === 0) return;

      if (e.key === "j") {
        e.preventDefault();
        setFocused((f) => Math.min(rows.length - 1, f + 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setFocused((f) => Math.max(0, f - 1));
      } else if (e.key === "a") {
        e.preventDefault();
        runApprove(rows[focused].id);
      } else if (e.key === "r") {
        e.preventDefault();
        runReject(rows[focused].id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, focused]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-ds-border-hairline bg-ds-surface-raised p-8 text-center">
        <p className="type-body-md text-ds-on-surface-muted">
          No pending tweets. Capture some from x.com with the extension.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="mb-3 text-xs text-ds-on-surface-muted">
        Keyboard: <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd>{" "}
        move · <kbd className="font-mono">a</kbd> approve ·{" "}
        <kbd className="font-mono">r</kbd> reject
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const isFocused = i === focused;
          const isPending = pendingRowId === row.id;
          return (
            <li
              key={row.id}
              onClick={() => setFocused(i)}
              className={[
                "flex items-start gap-4 rounded-md border bg-ds-surface-raised p-4 transition",
                isFocused
                  ? "border-ds-primary shadow-[0_0_0_1px_var(--ds-primary)_inset]"
                  : "border-ds-border-hairline",
                isPending ? "opacity-60" : "",
              ].join(" ")}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ds-on-surface-muted">
                  <span
                    aria-hidden
                    title={row.media_type ?? "no media"}
                    className="inline-flex h-4 w-4 items-center justify-center"
                  >
                    {row.media_type ? MEDIA_ICON[row.media_type] : "·"}
                  </span>
                  <span className="font-medium text-ds-on-surface">
                    @{row.author_handle}
                  </span>
                  <span>·</span>
                  <span>{fmtCount(row.likes)} likes</span>
                  {row.views != null ? (
                    <>
                      <span>·</span>
                      <span>{fmtCount(row.views)} views</span>
                    </>
                  ) : null}
                  <span>·</span>
                  <span>{fmtRelativeDate(row.captured_at)}</span>
                  {row.page_target ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ds-on-surface"
                      style={{ background: "rgba(10,10,10,0.06)" }}
                    >
                      {row.page_target}
                    </span>
                  ) : null}
                </div>
                <p className="type-body-md line-clamp-3 text-ds-on-surface">
                  {row.text_preview || (
                    <span className="italic text-ds-on-surface-muted">
                      (no text)
                    </span>
                  )}
                </p>
                <a
                  href={row.tweet_url}
                  target="_blank"
                  rel="noreferrer"
                  className="type-label-sm text-ds-on-surface-muted underline decoration-dotted underline-offset-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  open on x.com ↗
                </a>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    runApprove(row.id);
                  }}
                  className="w-full rounded-md bg-ds-primary px-3 py-2 text-sm font-semibold text-ds-on-primary hover:opacity-90 disabled:cursor-not-allowed"
                >
                  Approve &amp; Style
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    runReject(row.id);
                  }}
                  className="w-full rounded-md border border-ds-border-hairline px-3 py-2 text-sm text-ds-on-surface-muted hover:bg-[rgba(10,10,10,0.05)] disabled:cursor-not-allowed"
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
};
