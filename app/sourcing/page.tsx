import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { TweetQueueRow } from "@/lib/tweet-queue";
import { Header } from "../_components/Header";
import { QueueList } from "./_components/QueueList";
import { SortControl, type QueueSort } from "./_components/SortControl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchPending(sort: QueueSort): Promise<TweetQueueRow[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("tweet_queue")
    .select(
      "id, tweet_id, tweet_url, author_handle, likes, views, has_media, media_type, text_preview, page_target, status, source, captured_at",
    )
    .eq("status", "pending");

  q =
    sort === "likes"
      ? q.order("likes", { ascending: false })
      : q.order("views", { ascending: false, nullsFirst: false });

  q = q.order("captured_at", { ascending: false }).limit(200);

  const { data, error } = await q;
  if (error) throw new Error(`fetch pending queue failed: ${error.message}`);
  return (data ?? []) as TweetQueueRow[];
}

export default async function SourcingPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const params = await searchParams;
  const sort: QueueSort = params.sort === "likes" ? "likes" : "views";
  const rows = await fetchPending(sort);
  return (
    <div className="flex min-h-screen flex-col bg-ds-surface">
      <Header />
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-baseline justify-between">
          <h1 className="type-headline-md">Sourcing</h1>
          <div className="flex items-center gap-4">
            <SortControl current={sort} />
            <span className="type-label-sm text-ds-on-surface-muted">
              {rows.length} pending
            </span>
          </div>
        </div>
        <QueueList rows={rows} />
      </main>
    </div>
  );
}
