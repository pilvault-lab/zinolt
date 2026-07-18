import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { TweetQueueRow } from "@/lib/tweet-queue";
import { Header } from "../_components/Header";
import { QueueList } from "./_components/QueueList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchPending(): Promise<TweetQueueRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tweet_queue")
    .select(
      "id, tweet_id, tweet_url, author_handle, likes, views, has_media, media_type, text_preview, page_target, status, source, captured_at",
    )
    .eq("status", "pending")
    .order("views", { ascending: false, nullsFirst: false })
    .order("likes", { ascending: false })
    .order("captured_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`fetch pending queue failed: ${error.message}`);
  return (data ?? []) as TweetQueueRow[];
}

export default async function SourcingPage() {
  const rows = await fetchPending();
  return (
    <div className="flex min-h-screen flex-col bg-ds-surface">
      <Header />
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-baseline justify-between">
          <h1 className="type-title-lg">Sourcing</h1>
          <span className="type-label-sm text-ds-ink-muted">
            {rows.length} pending
          </span>
        </div>
        <QueueList rows={rows} />
      </main>
    </div>
  );
}
