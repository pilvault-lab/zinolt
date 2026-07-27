import type { WireSource } from "../sources";
import type { WireItem } from "../types";
import { fetchHn } from "./hn";
import { fetchKalshi } from "./kalshi";
import { fetchPolymarket } from "./polymarket";
import { fetchReddit } from "./reddit";
import { fetchRss } from "./rss";

export function fetchSource(source: WireSource): Promise<WireItem[]> {
  switch (source.type) {
    case "rss":
      return fetchRss(source);
    case "reddit":
      return fetchReddit(source);
    case "hn":
      return fetchHn(source);
    case "polymarket":
      return fetchPolymarket(source);
    case "kalshi":
      return fetchKalshi(source);
  }
}
