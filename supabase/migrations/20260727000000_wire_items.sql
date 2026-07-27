-- The Wire aggregator feed store.
-- Mirrors the local SQLite schema in lib/wire/db.ts (pre-Supabase),
-- adapted to Postgres types. Service-role writes only; no RLS needed
-- because the Wire dashboard is single-user and gated at the app layer.

create table if not exists public.wire_items (
  id            bigserial primary key,
  url           text        not null unique,
  title         text        not null,
  snippet       text        not null default '',
  source_name   text        not null,
  category      text        not null check (
                  category in ('markets','fintech','tech','predictions','culture')
                ),
  published_at  timestamptz not null,
  score         bigint,
  fetched_at    timestamptz not null default now(),
  starred       boolean     not null default false,
  used          boolean     not null default false,
  hidden        boolean     not null default false
);

create index if not exists wire_items_fetched_at_desc_idx
  on public.wire_items (fetched_at desc);
create index if not exists wire_items_published_at_desc_idx
  on public.wire_items (published_at desc);
create index if not exists wire_items_category_idx
  on public.wire_items (category);
-- Speed up the "starred first, then newest" default sort.
create index if not exists wire_items_starred_published_idx
  on public.wire_items (starred desc, published_at desc);
