import type { WireSource } from "../sources";
import { makeSnippet, toIso, type WireItem } from "../types";

type RedditListing = {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        title?: string;
        permalink?: string;
        url?: string;
        selftext?: string;
        created_utc?: number;
        score?: number;
        stickied?: boolean;
      };
    }>;
  };
};

export async function fetchReddit(source: WireSource): Promise<WireItem[]> {
  const res = await fetch(source.url, {
    headers: {
      // Reddit rejects the default node UA with 429/403.
      "User-Agent": "ZinoltWireBot/1.0 (localhost aggregator)",
      Accept: "application/json",
    },
    // Reddit's cache TTL is short enough that this is fine every sync.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`reddit ${res.status} ${res.statusText}`);
  const json = (await res.json()) as RedditListing;
  const children = json?.data?.children ?? [];
  const items: WireItem[] = [];
  for (const c of children) {
    const d = c?.data;
    if (!d || d.stickied) continue;
    const title = (d.title ?? "").trim();
    const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : "";
    if (!title || !permalink) continue;
    items.push({
      url: permalink,
      title,
      snippet: makeSnippet(d.selftext ?? d.url ?? ""),
      sourceName: source.name,
      category: source.category,
      publishedAt: toIso(d.created_utc ? d.created_utc * 1000 : undefined),
      score: typeof d.score === "number" ? d.score : undefined,
    });
  }
  return items;
}
