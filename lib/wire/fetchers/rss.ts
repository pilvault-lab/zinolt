import Parser from "rss-parser";
import type { WireSource } from "../sources";
import { makeSnippet, toIso, type WireItem } from "../types";

// Some feeds (Substack, Yahoo) 403 the default node UA — this UA passes.
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; ZinoltWireBot/1.0; +http://localhost)",
  Accept:
    "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
};

// rss-parser's built-in parseURL was sending headers that SEC EDGAR rejects
// with 403 even after passing the correct User-Agent via constructor
// options. Fetching the XML ourselves and calling parseString avoids the
// internal request machinery entirely and gives us exact control over
// per-source headers.
const parser = new Parser({ timeout: 15000 });

export async function fetchRss(source: WireSource): Promise<WireItem[]> {
  const headers = source.headers
    ? { ...DEFAULT_HEADERS, ...source.headers }
    : DEFAULT_HEADERS;

  const res = await fetch(source.url, {
    headers,
    redirect: "follow",
    // A slow feed shouldn't hold the whole sync hostage.
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Status code ${res.status}`);
  const xml = await res.text();
  const feed = await parser.parseString(xml);

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
