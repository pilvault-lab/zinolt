import type { WireCategory, WireSource } from "./sources";

export type WireItem = {
  url: string;
  title: string;
  snippet: string;
  sourceName: string;
  category: WireCategory;
  publishedAt: string; // ISO
  score?: number;
};

export type FetcherResult = {
  source: WireSource;
  items: WireItem[];
};

export function stripHtml(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

export function makeSnippet(input: string | undefined | null, max = 250): string {
  const s = stripHtml(input);
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export function toIso(input: string | number | Date | undefined | null): string {
  if (input == null) return new Date().toISOString();
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
