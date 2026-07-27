import type { WireSource } from "../sources";
import { makeSnippet, toIso, type WireItem } from "../types";

type HnStory = {
  id: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  time?: number;
  type?: string;
  dead?: boolean;
  deleted?: boolean;
};

const MIN_SCORE = 100;
const TOP_N = 30;

export async function fetchHn(source: WireSource): Promise<WireItem[]> {
  const idsRes = await fetch(source.url, { cache: "no-store" });
  if (!idsRes.ok) throw new Error(`hn ids ${idsRes.status}`);
  const ids = (await idsRes.json()) as number[];
  const top = ids.slice(0, TOP_N);

  const stories = await Promise.all(
    top.map(async (id) => {
      const r = await fetch(
        `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        { cache: "no-store" },
      );
      if (!r.ok) return null;
      return (await r.json()) as HnStory | null;
    }),
  );

  const items: WireItem[] = [];
  for (const s of stories) {
    if (!s || s.dead || s.deleted) continue;
    const score = typeof s.score === "number" ? s.score : 0;
    if (score <= MIN_SCORE) continue;
    const title = (s.title ?? "").trim();
    // HN stories may not have url (Ask HN, Show HN self-posts) — fall back to the item page.
    const url = (s.url ?? `https://news.ycombinator.com/item?id=${s.id}`).trim();
    if (!title) continue;
    items.push({
      url,
      title,
      snippet: makeSnippet(s.text ?? ""),
      sourceName: source.name,
      category: source.category,
      publishedAt: toIso(s.time ? s.time * 1000 : undefined),
      score,
    });
  }
  return items;
}
