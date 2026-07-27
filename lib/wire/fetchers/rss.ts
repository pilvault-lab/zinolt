import Parser from "rss-parser";
import type { WireSource } from "../sources";
import { makeSnippet, toIso, type WireItem } from "../types";

const parser = new Parser({
  timeout: 15000,
  headers: {
    // Some feeds (Substack, Yahoo) 403 the default node UA.
    "User-Agent":
      "Mozilla/5.0 (compatible; ZinoltWireBot/1.0; +http://localhost)",
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
  },
});

export async function fetchRss(source: WireSource): Promise<WireItem[]> {
  const feed = await parser.parseURL(source.url);
  const items: WireItem[] = [];
  for (const it of feed.items ?? []) {
    const url = (it.link ?? it.guid ?? "").trim();
    const title = (it.title ?? "").trim();
    if (!url || !title) continue;
    items.push({
      url,
      title,
      snippet: makeSnippet(it.contentSnippet ?? it.summary ?? it.content ?? ""),
      sourceName: source.name,
      category: source.category,
      publishedAt: toIso(it.isoDate ?? it.pubDate),
    });
  }
  return items;
}
