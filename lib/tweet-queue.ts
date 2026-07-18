// Types matching the public.tweet_queue Supabase table.
// See docs/tweet-sourcer-prd.md §1 for the source of truth.

export type QueueStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "rendered"
  | "expired";

export type QueueSource = "extension_manual" | "extension_auto" | "scraper";

export type QueueMediaType = "video" | "gif" | "photo";

export interface TweetQueueRow {
  id: string;
  tweet_id: string;
  tweet_url: string;
  author_handle: string;
  likes: number;
  views: number | null;
  has_media: boolean;
  media_type: QueueMediaType | null;
  text_preview: string | null;
  page_target: string | null;
  status: QueueStatus;
  source: QueueSource;
  captured_at: string;
}
