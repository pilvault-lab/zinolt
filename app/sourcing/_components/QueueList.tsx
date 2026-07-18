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

export const QueueList: React.FC<{ rows: TweetQueueRow[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-ds-border-hairline bg-ds-surface p-8 text-center">
        <p className="type-body-md text-ds-ink-muted">
          No pending tweets. Capture some from x.com with the extension.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex items-start gap-4 rounded-md border border-ds-border-hairline bg-ds-surface p-4"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-ds-ink-muted">
              <span
                aria-hidden
                title={row.media_type ?? "no media"}
                className="inline-flex h-4 w-4 items-center justify-center"
              >
                {row.media_type ? MEDIA_ICON[row.media_type] : "·"}
              </span>
              <span className="font-medium">@{row.author_handle}</span>
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
                <>
                  <span>·</span>
                  <span className="rounded bg-ds-ink/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    {row.page_target}
                  </span>
                </>
              ) : null}
            </div>
            <p className="type-body-md line-clamp-3 text-ds-ink">
              {row.text_preview || (
                <span className="text-ds-ink-muted italic">(no text)</span>
              )}
            </p>
            <a
              href={row.tweet_url}
              target="_blank"
              rel="noreferrer"
              className="type-label-sm text-ds-ink-muted underline decoration-dotted underline-offset-4"
            >
              open on x.com ↗
            </a>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <form action={approveAndStyle.bind(null, row.id)}>
              <button
                type="submit"
                className="w-full rounded-md bg-ds-ink px-3 py-2 text-sm font-semibold text-ds-surface hover:opacity-90"
              >
                Approve &amp; Style
              </button>
            </form>
            <form action={rejectRow.bind(null, row.id)}>
              <button
                type="submit"
                className="w-full rounded-md border border-ds-border-hairline px-3 py-2 text-sm text-ds-ink-muted hover:bg-ds-ink/5"
              >
                Reject
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
};
