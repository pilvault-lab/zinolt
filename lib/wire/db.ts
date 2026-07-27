import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { WireCategory } from "./sources";
import type { WireItem } from "./types";

const TABLE = "wire_items";

export type WireItemRow = {
  id: number;
  url: string;
  title: string;
  snippet: string;
  source_name: string;
  category: WireCategory;
  published_at: string;
  score: number | null;
  fetched_at: string;
  // Postgres booleans arrive as true/false; we keep the 0|1 shape on the
  // wire so the client component doesn't need branching.
  starred: 0 | 1;
  used: 0 | 1;
  hidden: 0 | 1;
};

type DbRow = {
  id: number;
  url: string;
  title: string;
  snippet: string;
  source_name: string;
  category: WireCategory;
  published_at: string;
  score: number | null;
  fetched_at: string;
  starred: boolean;
  used: boolean;
  hidden: boolean;
};

function normalize(r: DbRow): WireItemRow {
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    snippet: r.snippet,
    source_name: r.source_name,
    category: r.category,
    published_at: r.published_at,
    score: r.score,
    fetched_at: r.fetched_at,
    starred: r.starred ? 1 : 0,
    used: r.used ? 1 : 0,
    hidden: r.hidden ? 1 : 0,
  };
}

export async function insertItems(items: WireItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const now = new Date().toISOString();
  const rows = items.map((it) => ({
    url: it.url,
    title: it.title,
    snippet: it.snippet,
    source_name: it.sourceName,
    category: it.category,
    published_at: it.publishedAt,
    score: it.score ?? null,
    fetched_at: now,
  }));

  // Postgres upsert-ignore: `ignoreDuplicates: true` translates to
  // ON CONFLICT (url) DO NOTHING. `select("id")` returns only the newly
  // inserted rows so we can count what was truly new (existing rows are
  // omitted from the returned set).
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`insertItems failed: ${error.message}`);
  return data?.length ?? 0;
}

/** Delete unstarred, unused items older than `days` days by `fetched_at`. */
export async function cleanupOld(days = 14): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .delete()
    .eq("starred", false)
    .eq("used", false)
    .lt("fetched_at", cutoff)
    .select("id");

  if (error) throw new Error(`cleanupOld failed: ${error.message}`);
  return data?.length ?? 0;
}

export type ListFilter = {
  category?: WireCategory | "all";
  sinceHours?: number;
  text?: string;
  includeHidden?: boolean;
};

export async function listItems(filter: ListFilter = {}): Promise<WireItemRow[]> {
  let q = getSupabaseAdmin()
    .from(TABLE)
    .select(
      "id, url, title, snippet, source_name, category, published_at, score, fetched_at, starred, used, hidden",
    );

  if (!filter.includeHidden) q = q.eq("hidden", false);
  if (filter.category && filter.category !== "all") {
    q = q.eq("category", filter.category);
  }
  if (typeof filter.sinceHours === "number") {
    const cutoff = new Date(
      Date.now() - filter.sinceHours * 60 * 60 * 1000,
    ).toISOString();
    q = q.gte("published_at", cutoff);
  }
  if (filter.text && filter.text.trim()) {
    // ilike on OR across the three text-y columns. `.or()` takes a raw
    // PostgREST filter string — asterisks are wildcards, and any comma or
    // paren inside the value must be escaped.
    const like = escapePgrst(filter.text.trim());
    q = q.or(
      `title.ilike.%${like}%,snippet.ilike.%${like}%,source_name.ilike.%${like}%`,
    );
  }

  // Starred first, then newest published_at. Supabase supports chained
  // .order() calls in the same request.
  q = q
    .order("starred", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(500);

  const { data, error } = await q;
  if (error) throw new Error(`listItems failed: ${error.message}`);
  return (data ?? []).map((r) => normalize(r as DbRow));
}

// PostgREST treats `,` `(` `)` and `.` as syntax inside `.or()` filter
// strings. Backslash-escape them so a user query containing commas doesn't
// break the whole filter.
function escapePgrst(s: string): string {
  return s.replace(/[,()]/g, "\\$&");
}

export type ItemFlag = "starred" | "used" | "hidden";

export async function setFlag(
  id: number,
  flag: ItemFlag,
  value: 0 | 1,
): Promise<0 | 1> {
  const { error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({ [flag]: value === 1 })
    .eq("id", id);
  if (error) throw new Error(`setFlag failed: ${error.message}`);
  return value;
}

export async function getItem(id: number): Promise<WireItemRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select(
      "id, url, title, snippet, source_name, category, published_at, score, fetched_at, starred, used, hidden",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getItem failed: ${error.message}`);
  return data ? normalize(data as DbRow) : null;
}
