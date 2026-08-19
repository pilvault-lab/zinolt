/**
 * Build (+ render) one ranking video from a small manifest.
 *
 * Manifest JSON (see scripts/rankings/README.md for full schema):
 *   {
 *     "slug": "most-valuable-brands-2026",
 *     "title": "Top 10 Most Valuable Brands",
 *     "metricLabel": "brand value",
 *     "format": "usd-b",                       // usd-t | usd-b | usd-m | usd | int | pct
 *     "asOfDate": "August 2026",
 *     "portraitBg": "light",                   // dark | light (default dark)
 *     "sources": ["https://interbrand.com/…"],
 *     "assetKind": "company",                  // company | person | country | crypto | custom
 *     "entries": [
 *       { "rank": 1, "name": "Apple", "value": 502, "ticker": "AAPL" },
 *       ...
 *     ]
 *   }
 *
 * Per-entry asset fields (depend on assetKind):
 *   company/brand → ticker: "AAPL"           (CompaniesMarketCap logo)
 *   person        → wikiTitle: "Elon_Musk"   (Wikipedia REST portrait)
 *   country       → wikiFile: "Flag_of_the_United_States.svg"  (Commons flag)
 *   crypto        → coinId: "bitcoin"        (CoinGecko coin image)
 *   custom        → imageUrl: "https://…"    (any direct URL)
 *
 * What this script does, per manifest:
 *   1. Downloads assets → public/ranking/assets/{slug}/NN-<name>.<ext>
 *   2. Writes data file → lib/ranking/data/{slug}.ts
 *   3. Registers it in lib/ranking/index.ts (idempotent)
 *   4. Renders mp4  → outputs/rankings/{slug}.mp4  (unless --no-render)
 *
 * Usage:
 *   npx tsx scripts/build-ranking.ts --manifest path/to/manifest.json
 *   npx tsx scripts/build-ranking.ts --manifest ./m.json --no-render
 *   npx tsx scripts/build-ranking.ts --manifest ./m.json --top-n 5
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { Ranking, RankingEntry } from "../lib/ranking/types";

const ROOT = resolve(join(import.meta.dirname, ".."));
const ASSETS_ROOT = join(ROOT, "public", "ranking", "assets");
const DATA_ROOT = join(ROOT, "lib", "ranking", "data");
const INDEX_PATH = join(ROOT, "lib", "ranking", "index.ts");
const OUT_ROOT = join(ROOT, "outputs", "rankings");

// ─── Types ───────────────────────────────────────────────────────────────────
type AssetKind = "company" | "brand" | "person" | "country" | "crypto" | "custom";

type ManifestEntry = {
  rank: number;
  name: string;
  value: number;
  ticker?: string;      // company/brand
  wikiTitle?: string;   // person
  wikiFile?: string;    // country (e.g. "Flag_of_the_United_States.svg")
  coinId?: string;      // crypto
  imageUrl?: string;    // custom
  portraitBg?: "dark" | "light";
  color?: string;
  note?: string;
};

type Manifest = {
  slug: string;
  title: string;
  metricLabel: string;
  format: Ranking["format"];
  asOfDate: string;
  portraitBg?: "dark" | "light";
  sources?: string[];
  assetKind: AssetKind;
  /**
   * Composition layout. Default (going forward) is "horizontal" — rows stack
   * with bars growing left→right, names fully visible in a left column.
   * "vertical" is the older pedestal-elevation style.
   */
  layout?: "horizontal" | "vertical";
  entries: ManifestEntry[];
};

// ─── CLI arg parsing ─────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

// ─── shell helper ────────────────────────────────────────────────────────────
function run(cmd: string, cmdArgs: string[], opts: { env?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // On Windows, npx and other .cmd shims need shell:true so cmd.exe
    // handles the arg quoting for JSON props containing "".
    const isWindows = process.platform === "win32";
    const child = spawn(cmd, cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: isWindows,
      env: { ...process.env, ...opts.env },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); process.stdout.write(c); });
    child.stderr.on("data", (c) => { stderr += c.toString(); process.stderr.write(c); });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    child.on("error", () => resolve({ code: -1, stdout, stderr }));
  });
}

async function fetchBuffer(url: string, headers: Record<string, string> = {}): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 zinolt-ranking-builder/1.0 (pilvault@gmail.com)",
        "Referer": "https://en.wikipedia.org/",
        ...headers,
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 300) return null; // error pages
    return buf;
  } catch { return null; }
}

// ─── Asset fetchers ──────────────────────────────────────────────────────────

/** Downloads a company / brand logo from CompaniesMarketCap. */
async function fetchCompanyLogo(ticker: string): Promise<{ buf: Buffer; ext: string } | null> {
  // Try 256 first, then 128, then 64 (smaller ticker sets sometimes miss 256).
  for (const size of [256, 128, 64]) {
    const url = `https://companiesmarketcap.com/img/company-logos/${size}/${ticker}.webp`;
    const buf = await fetchBuffer(url, { Referer: "https://companiesmarketcap.com/" });
    if (buf && buf.slice(0, 4).toString("ascii").startsWith("RIFF")) {
      return { buf, ext: "webp" };
    }
  }
  return null;
}

/**
 * Downloads a Wikipedia page's main image via the REST summary API.
 * Works for people, companies, apps, sports teams — anything with a
 * Wikipedia article that has an infobox image.
 *
 * We DON'T rewrite the thumbnail width — Wikipedia only serves a specific
 * whitelist per file (varies), so we use whatever URL the API hands us
 * and strip the utm_* tracking query.
 */
async function fetchWikiPortrait(wikiTitle: string): Promise<{ buf: Buffer; ext: string } | null> {
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
  try {
    const res = await fetch(summaryUrl, {
      headers: { "User-Agent": "zinolt-ranking-builder/1.0 (pilvault@gmail.com)" },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    // Prefer the higher-res originalimage when present; else thumbnail.
    const src: string | undefined = j.originalimage?.source ?? j.thumbnail?.source;
    if (!src) return null;
    const cleanUrl = src.replace(/\?utm_[^"]*$/, "");
    const buf = await fetchBuffer(cleanUrl, { Referer: "https://en.wikipedia.org/" });
    if (!buf) return null;
    const ext = cleanUrl.match(/\.(jpg|jpeg|png|webp|svg)(?:\?|$)/i)?.[1]?.toLowerCase() ?? "jpg";
    return { buf, ext };
  } catch { return null; }
}

/** Downloads a Commons flag (or any Commons file) by title. */
async function fetchCommonsFile(wikiFile: string, width = 660): Promise<{ buf: Buffer; ext: string } | null> {
  // API to get the file's actual URL on upload.wikimedia.org.
  const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(wikiFile)}&prop=imageinfo&iiprop=url&iiurlwidth=${width}&format=json`;
  try {
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "zinolt-ranking-builder/1.0 (pilvault@gmail.com)" },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const page = Object.values(j.query?.pages ?? {})[0] as any;
    const src: string | undefined = page?.imageinfo?.[0]?.thumburl ?? page?.imageinfo?.[0]?.url;
    if (!src) return null;
    const buf = await fetchBuffer(src, { Referer: "https://commons.wikimedia.org/" });
    if (!buf) return null;
    const ext = src.match(/\.(jpg|jpeg|png|webp|svg)(?:\?|$)/i)?.[1]?.toLowerCase() ?? "png";
    return { buf, ext };
  } catch { return null; }
}

/** Downloads a CoinGecko coin image. */
async function fetchCoinIcon(coinId: string): Promise<{ buf: Buffer; ext: string } | null> {
  // CoinGecko's `/coins/{id}` endpoint returns image URLs (small/thumb/large).
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "zinolt-ranking-builder/1.0" },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const src: string | undefined = j.image?.large ?? j.image?.small;
    if (!src) return null;
    const buf = await fetchBuffer(src, { Referer: "https://www.coingecko.com/" });
    if (!buf) return null;
    const ext = src.match(/\.(jpg|jpeg|png|webp|svg)(?:\?|$)/i)?.[1]?.toLowerCase() ?? "png";
    return { buf, ext };
  } catch { return null; }
}

/** Downloads a custom URL directly. */
async function fetchCustom(url: string): Promise<{ buf: Buffer; ext: string } | null> {
  const buf = await fetchBuffer(url);
  if (!buf) return null;
  const ext = url.match(/\.(jpg|jpeg|png|webp|svg)(?:\?|$)/i)?.[1]?.toLowerCase() ?? "png";
  return { buf, ext };
}

/**
 * Fetch chain — every entry MUST land a real image. Primary source is set by
 * assetKind; if that misses, we fall back to Wikipedia using the entry's
 * `wikiTitle` (or the plain `name` if wikiTitle isn't set). Rendering an
 * entry with no image is not allowed — the caller should treat an empty
 * relPath as a fatal build error and stop.
 */
async function fetchEntryAsset(
  entry: ManifestEntry,
  kind: AssetKind,
  slug: string,
): Promise<{ relPath: string; note?: string }> {
  const dir = join(ASSETS_ROOT, slug);
  mkdirSync(dir, { recursive: true });
  const nn = String(entry.rank).padStart(2, "0");
  const baseName = `${nn}-${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`;

  type Attempt = { fn: () => Promise<{ buf: Buffer; ext: string } | null>; label: string };
  const chain: Attempt[] = [];

  // Per-entry OVERRIDES — always tried first. Use these to pin a specific
  // official logo when Wikipedia's page image is wrong / historic / missing.
  if (entry.imageUrl) chain.push({
    fn: () => fetchCustom(entry.imageUrl!),
    label: `custom (entry override) ${entry.imageUrl}`,
  });
  if (entry.wikiFile) chain.push({
    fn: () => fetchCommonsFile(entry.wikiFile!),
    label: `Commons (entry override) ${entry.wikiFile}`,
  });

  // Primary source — dictated by kind.
  switch (kind) {
    case "company":
    case "brand":
      if (entry.ticker) chain.push({
        fn: () => fetchCompanyLogo(entry.ticker!),
        label: `CompaniesMarketCap ${entry.ticker}`,
      });
      break;
    case "person":
      if (entry.wikiTitle) chain.push({
        fn: () => fetchWikiPortrait(entry.wikiTitle!),
        label: `Wikipedia ${entry.wikiTitle}`,
      });
      break;
    case "country":
      if (entry.wikiFile) chain.push({
        fn: () => fetchCommonsFile(entry.wikiFile!),
        label: `Commons ${entry.wikiFile}`,
      });
      break;
    case "crypto":
      if (entry.coinId) chain.push({
        fn: () => fetchCoinIcon(entry.coinId!),
        label: `CoinGecko ${entry.coinId}`,
      });
      break;
    case "custom":
      if (entry.imageUrl) chain.push({
        fn: () => fetchCustom(entry.imageUrl!),
        label: `custom ${entry.imageUrl}`,
      });
      break;
  }

  // Universal fallbacks — try Wikipedia by title (if set) or by name, then
  // a Commons file lookup if wikiFile is present.
  if (entry.wikiTitle) chain.push({
    fn: () => fetchWikiPortrait(entry.wikiTitle!),
    label: `Wikipedia fallback ${entry.wikiTitle}`,
  });
  chain.push({
    fn: () => fetchWikiPortrait(entry.name.replace(/\s+/g, "_")),
    label: `Wikipedia fallback (name) ${entry.name}`,
  });

  for (const attempt of chain) {
    const asset = await attempt.fn();
    if (asset) {
      const filename = `${baseName}.${asset.ext}`;
      writeFileSync(join(dir, filename), asset.buf);
      console.log(`    ✓ [${entry.rank}] ${entry.name} → ${filename} (${asset.buf.length}B, ${attempt.label})`);
      return { relPath: `/ranking/assets/${slug}/${filename}` };
    }
  }
  console.log(`    ✗ [${entry.rank}] ${entry.name}: ALL sources failed`);
  return { relPath: "", note: `fetch failed across ${chain.length} sources` };
}

// ─── Data file writer ────────────────────────────────────────────────────────
function serializeString(s: string): string {
  return JSON.stringify(s);
}

function writeDataFile(manifest: Manifest, assetPaths: Map<number, string>) {
  const filePath = join(DATA_ROOT, `${manifest.slug}.ts`);
  const lines: string[] = [];
  lines.push(`import type { Ranking } from "../types";`);
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * ${manifest.title} — ${manifest.asOfDate}.`);
  lines.push(` *`);
  lines.push(` * AUTO-GENERATED by scripts/build-ranking.ts. Re-run the builder rather`);
  lines.push(` * than hand-editing — hand edits will be wiped on the next build.`);
  if (manifest.sources && manifest.sources.length > 0) {
    lines.push(` *`);
    lines.push(` * Sources:`);
    for (const src of manifest.sources) lines.push(` *   ${src}`);
  }
  lines.push(` */`);
  lines.push(``);
  lines.push(`const ranking: Ranking = {`);
  lines.push(`  slug: ${serializeString(manifest.slug)},`);
  lines.push(`  title: ${serializeString(manifest.title)},`);
  lines.push(`  metricLabel: ${serializeString(manifest.metricLabel)},`);
  lines.push(`  format: ${serializeString(manifest.format)},`);
  lines.push(`  asOfDate: ${serializeString(manifest.asOfDate)},`);
  lines.push(`  verifiedOnISO: ${serializeString(new Date().toISOString().slice(0, 10))},`);
  if (manifest.sources && manifest.sources.length > 0) {
    lines.push(`  sources: [`);
    for (const s of manifest.sources) lines.push(`    ${serializeString(s)},`);
    lines.push(`  ],`);
  }
  if (manifest.portraitBg) {
    lines.push(`  portraitBg: ${serializeString(manifest.portraitBg)},`);
  }
  lines.push(`  entries: [`);
  for (const e of manifest.entries.sort((a, b) => a.rank - b.rank)) {
    const image = assetPaths.get(e.rank);
    const entryObj: Partial<RankingEntry> & { note?: string } = {
      rank: e.rank,
      name: e.name,
      value: e.value,
      image: image ?? null,
    };
    if (e.portraitBg) entryObj.portraitBg = e.portraitBg;
    if (e.color) entryObj.color = e.color;
    if (e.note) entryObj.note = e.note;
    lines.push(`    ${JSON.stringify(entryObj)},`);
  }
  lines.push(`  ],`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`export default ranking;`);
  writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
  console.log(`  ✓ wrote ${filePath}`);
}

// ─── Index registrar (idempotent) ────────────────────────────────────────────
function registerInIndex(slug: string) {
  const importName = slug.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    // camelCase-ify — first char stays lower, rest of tokens capitalized.
    .replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
  const src = readFileSync(INDEX_PATH, "utf8");

  if (src.includes(`./data/${slug}`)) {
    console.log(`  ✓ ${slug} already registered in index.ts`);
    return;
  }

  // Insert import after the last import line.
  const importLine = `import ${importName} from "./data/${slug}";`;
  const lines = src.split(/\r?\n/);
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i])) lastImportIdx = i;
  }
  lines.splice(lastImportIdx + 1, 0, importLine);

  // Insert into RANKINGS array — before `] as const;`.
  const rebuilt = lines.join("\n");
  const inserted = rebuilt.replace(
    /(\n)(\] as const;)/,
    `$1  ${importName},$1$2`,
  );
  writeFileSync(INDEX_PATH, inserted, "utf8");
  console.log(`  ✓ registered ${slug} in index.ts`);
}

// ─── Render ──────────────────────────────────────────────────────────────────
async function render(
  slug: string,
  topN: number,
  useInitials: boolean,
  layout: "horizontal" | "vertical",
): Promise<boolean> {
  mkdirSync(OUT_ROOT, { recursive: true });
  const outPath = join(OUT_ROOT, `${slug}.mp4`);
  // Compute end frame from topN so we don't render past the animation.
  //   riseStart 0.3s + topN*2s rise + 3s hold on winner. CTA disabled.
  const totalSec = 0.3 + topN * 2 + 3;
  const endFrame = Math.round(totalSec * 60);
  const compositionId = layout === "horizontal" ? "RankingHorizontal" : "Ranking";
  // Write props to a temp file — --props accepts a file path, which sidesteps
  // Windows cmd.exe's mangling of JSON-with-double-quotes on the command line.
  const propsPath = join(OUT_ROOT, `.props-${slug}.json`);
  writeFileSync(propsPath, JSON.stringify({ slug, topN, useInitials }), "utf8");
  console.log(`  → rendering ${slug} (composition=${compositionId}, topN=${topN}, ${totalSec.toFixed(1)}s, ${endFrame} frames)`);
  const res = await run("npx", [
    "remotion", "render", compositionId, outPath,
    "--props", propsPath,
    "--frames", `0-${endFrame}`,
    "--codec", "h264",
  ], {
    env: { RANKING_ONLY: "1" },
    timeoutMs: 30 * 60 * 1000,
  });
  try { require("node:fs").unlinkSync(propsPath); } catch {}
  if (res.code !== 0 || !existsSync(outPath) || statSync(outPath).size < 100_000) {
    console.log(`  ✗ render failed for ${slug}`);
    return false;
  }
  console.log(`  ✓ ${outPath} (${(statSync(outPath).size / 1e6).toFixed(1)} MB)`);
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest as string | undefined;
  if (!manifestPath) {
    console.error("Usage: build-ranking.ts --manifest path.json [--no-render] [--top-n N] [--use-initials]");
    process.exit(1);
  }
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.slug || !manifest.entries || manifest.entries.length === 0) {
    console.error("Manifest missing slug or entries.");
    process.exit(1);
  }

  console.log(`\n▶ ${manifest.title}  (${manifest.slug})`);
  console.log(`  ${manifest.entries.length} entries · asset kind: ${manifest.assetKind}`);

  // 1. Fetch assets. Every entry must land a real image — no exceptions.
  console.log(`\n  [1/4] fetching assets …`);
  const assetPaths = new Map<number, string>();
  const missing: string[] = [];
  for (const entry of manifest.entries) {
    const { relPath } = await fetchEntryAsset(entry, manifest.assetKind, manifest.slug);
    if (relPath) assetPaths.set(entry.rank, relPath);
    else missing.push(`#${entry.rank} ${entry.name}`);
  }
  if (missing.length > 0) {
    console.error(`\n  ✗ ABORT — ${missing.length} entries have no image:`);
    for (const m of missing) console.error(`    - ${m}`);
    console.error(`  Fix the manifest (correct wikiTitle / ticker / imageUrl) and re-run.`);
    process.exit(1);
  }

  if (args["dry-run"]) {
    console.log(`\n  ✓ dry-run — all ${manifest.entries.length} assets fetched. Not writing data/index/render.`);
    return;
  }

  // 2. Write data file.
  console.log(`\n  [2/4] writing data file …`);
  mkdirSync(DATA_ROOT, { recursive: true });
  writeDataFile(manifest, assetPaths);

  // 3. Register in index.
  console.log(`\n  [3/4] registering in index.ts …`);
  registerInIndex(manifest.slug);

  // 4. Render (unless --no-render).
  if (args["no-render"]) {
    console.log(`\n  [4/4] --no-render, skipping.`);
    return;
  }
  console.log(`\n  [4/4] rendering mp4 …`);
  const topN = Number(args["top-n"] ?? manifest.entries.length);
  const useInitials = Boolean(args["use-initials"]);
  // Default to horizontal going forward. Manifest.layout can pin either.
  const layout: "horizontal" | "vertical" =
    (args["layout"] as any) || manifest.layout || "horizontal";
  const ok = await render(manifest.slug, topN, useInitials, layout);
  if (!ok) process.exit(1);

  console.log(`\n✓ Done.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
