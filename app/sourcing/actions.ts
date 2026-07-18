"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { TweetQueueRow } from "@/lib/tweet-queue";

// Approve a pending row and redirect to the editor with the tweet URL, the
// chosen page profile, and the queue_id so the editor can mark it 'rendered'
// after a successful export.
export async function approveAndStyle(rowId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("tweet_queue")
    .update({ status: "approved" })
    .eq("id", rowId)
    .select("id, tweet_url, page_target")
    .single<Pick<TweetQueueRow, "id" | "tweet_url" | "page_target">>();

  if (error) throw new Error(`approve failed: ${error.message}`);
  if (!data) throw new Error("row not found");

  const params = new URLSearchParams({
    url: data.tweet_url,
    queue_id: data.id,
  });
  if (data.page_target) params.set("profile", data.page_target);

  revalidatePath("/sourcing");
  redirect(`/tweet-video?${params.toString()}`);
}

export async function rejectRow(rowId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("tweet_queue")
    .update({ status: "rejected" })
    .eq("id", rowId);

  if (error) throw new Error(`reject failed: ${error.message}`);
  revalidatePath("/sourcing");
}
