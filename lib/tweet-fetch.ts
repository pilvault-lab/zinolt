export interface FetchedTweet {
  id: string;
  text: string;
  author: {
    name: string;
    handle: string;
    avatarUrl: string;
    verified: boolean;
  };
  createdAt: string;
  stats: {
    likes: number;
    retweets: number;
    replies: number;
    views?: number;
  };
  media: TweetMedia[];
  quoted?: QuotedTweet;
}

export interface TweetMedia {
  type: "photo" | "video" | "gif";
  url: string;
  width: number;
  height: number;
  durationMs?: number;
  thumbnailUrl?: string;
}

export interface QuotedTweet {
  id: string;
  text: string;
  author: {
    name: string;
    handle: string;
    avatarUrl: string;
    verified: boolean;
  };
  createdAt: string;
  media: TweetMedia[];
}

export type TweetFetchError =
  | "invalid_url"
  | "not_found"
  | "protected"
  | "both_sources_failed";

export async function fetchTweet(
  input: string,
  force?: "syndication",
): Promise<FetchedTweet> {
  const params = new URLSearchParams({ url: input });
  if (force) params.set("force", force);
  const res = await fetch(`/api/tweet?${params.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: TweetFetchError;
    };
    throw new Error(body.error ?? "both_sources_failed");
  }
  return (await res.json()) as FetchedTweet;
}
