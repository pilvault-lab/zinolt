// Local SQLite store for The Wire.
//
// Uses Node 24's built-in `node:sqlite` (synchronous API) instead of
// better-sqlite3 — native builds of better-sqlite3 require Python +
// MSVC on Windows, which isn't set up on this box. The API surface we
// need (prepare / run / all / transaction) is essentially the same.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WireCategory } from "./sources";
import type { WireItem } from "./types";

const DATA_DIR = join(process.cwd(), ".wire");
const DB_PATH = join(DATA_DIR, "wire.db");

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA foreign_keys = ON;");
  d.exec(`
    CREATE TABLE IF NOT EXISTS wire_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      url           TEXT NOT NULL UNIQUE,
      title         TEXT NOT NULL,
      snippet       TEXT NOT NULL DEFAULT '',
      source_name   TEXT NOT NULL,
      category      TEXT NOT NULL,
      published_at  TEXT NOT NULL,
      score         INTEGER,
      fetched_at    TEXT NOT NULL,
      starred       INTEGER NOT NULL DEFAULT 0,
      used          INTEGER NOT NULL DEFAULT 0,
      hidden        INTEGER NOT NULL DEFAULT 0
    );
  `);
  d.exec(
    "CREATE INDEX IF NOT EXISTS idx_wire_items_fetched_at ON wire_items(fetched_at DESC);",
  );
  d.exec(
    "CREATE INDEX IF NOT EXISTS idx_wire_items_published_at ON wire_items(published_at DESC);",
  );
  _db = d;
  return d;
}

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
  starred: 0 | 1;
  used: 0 | 1;
  hidden: 0 | 1;
};

export function insertItems(items: WireItem[]): number {
  if (items.length === 0) return 0;
  const stmt = db().prepare(`
    INSERT OR IGNORE INTO wire_items
      (url, title, snippet, source_name, category, published_at, score, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  let inserted = 0;
  // node:sqlite has no transaction() helper — use BEGIN / COMMIT explicitly.
  db().exec("BEGIN");
  try {
    for (const it of items) {
      const res = stmt.run(
        it.url,
        it.title,
        it.snippet,
        it.sourceName,
        it.category,
        it.publishedAt,
        it.score ?? null,
        now,
      );
      if (typeof res.changes === "number" && res.changes > 0) inserted += 1;
    }
    db().exec("COMMIT");
  } catch (err) {
    db().exec("ROLLBACK");
    throw err;
  }
  return inserted;
}

/** Delete unstarred, unused items older than `days` days by `fetched_at`. */
export function cleanupOld(days = 14): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const res = db()
    .prepare(
      `DELETE FROM wire_items
       WHERE starred = 0 AND used = 0 AND fetched_at < ?`,
    )
    .run(cutoff);
  return typeof res.changes === "number" ? res.changes : 0;
}

export type ListFilter = {
  category?: WireCategory | "all";
  sinceHours?: number; // e.g., 24 for "today", 72 for "last 3 days"
  text?: string;
  includeHidden?: boolean;
};

export function listItems(filter: ListFilter = {}): WireItemRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (!filter.includeHidden) clauses.push("hidden = 0");
  if (filter.category && filter.category !== "all") {
    clauses.push("category = ?");
    params.push(filter.category);
  }
  if (typeof filter.sinceHours === "number") {
    const cutoff = new Date(
      Date.now() - filter.sinceHours * 60 * 60 * 1000,
    ).toISOString();
    clauses.push("published_at >= ?");
    params.push(cutoff);
  }
  if (filter.text && filter.text.trim()) {
    clauses.push("(title LIKE ? OR snippet LIKE ? OR source_name LIKE ?)");
    const like = `%${filter.text.trim()}%`;
    params.push(like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  // Starred float to top; then newest first.
  const sql = `
    SELECT id, url, title, snippet, source_name, category, published_at,
           score, fetched_at, starred, used, hidden
    FROM wire_items
    ${where}
    ORDER BY starred DESC, published_at DESC
    LIMIT 500
  `;
  const raw = db().prepare(sql).all(...params) as unknown as WireItemRow[];
  // node:sqlite returns null-prototype rows. Next.js refuses to serialize
  // those from a Server Component to a Client Component — copy to plain objects.
  return raw.map(toPlain);
}

function toPlain(r: WireItemRow): WireItemRow {
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
    starred: r.starred,
    used: r.used,
    hidden: r.hidden,
  };
}

export type ItemFlag = "starred" | "used" | "hidden";

/** Set a single boolean flag on an item. Returns the new value (0/1). */
export function setFlag(id: number, flag: ItemFlag, value: 0 | 1): 0 | 1 {
  db()
    .prepare(`UPDATE wire_items SET ${flag} = ? WHERE id = ?`)
    .run(value, id);
  return value;
}

export function getItem(id: number): WireItemRow | null {
  const row = db()
    .prepare(
      `SELECT id, url, title, snippet, source_name, category, published_at,
              score, fetched_at, starred, used, hidden
       FROM wire_items WHERE id = ?`,
    )
    .get(id) as WireItemRow | undefined;
  return row ? toPlain(row) : null;
}
