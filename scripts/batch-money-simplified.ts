/**
 * Batch: money-simplified — channel-sourced version.
 *
 * Sources short beginner concept clips from a curated channel list
 * (Next Level Life prioritized), then runs them through the clip-studio
 * letterbox pipeline:
 *   - 16:9 source scaled to full width, centered on 1080x1920 black canvas
 *   - Top Vernavle "hook" headline (e.g. "Compound interest explained")
 *   - NO burned sentence captions (hook only)
 *   - Vernavle watermark
 *   - 1080p bestvideo+bestaudio (quality preserved)
 *
 * Flow per concept:
 *   1. Iterate CHANNELS in priority order.
 *   2. For each channel, list its uploads (cached) and title-filter for the concept.
 *   3. Fetch subs for the top few title matches; score by transcript density.
 *   4. Pick the highest scorer that clears the bar; stop iterating channels.
 *   5. Section-download the chosen ≤120s window at 1080p.
 *   6. Letterbox + hook + watermark → outputs/money-simplified/{slug}.mp4.
 *
 * Usage:
 *   npx tsx scripts/batch-money-simplified.ts                         # all concepts
 *   npx tsx scripts/batch-money-simplified.ts compound-interest ...   # subset
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brandAssetPaths, buildTreatmentArgs, fitHeadline, runFfmpeg } from "../lib/video-treatment";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "outputs", "money-simplified");
const COOKIES = join(ROOT, "cookies.txt");
const TMP = join(tmpdir(), "zinolt-money-simplified");
const CHAN_CACHE = join(TMP, "channel-lists");
const REPORT_PATH = join(OUT_DIR, "run-report.md");

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(CHAN_CACHE, { recursive: true });

const BRAND = brandAssetPaths(join(ROOT, "public"));

// ─── Channel list (priority order) ───────────────────────────────────────────
type Channel = { key: string; name: string; handle: string; priority: number };

const CHANNELS: Channel[] = [
  { key: "nll",  name: "Next Level Life",          handle: "@NextLevelLife",         priority: 100 },
  { key: "tae",  name: "Tae Kim (Financial Tortoise)", handle: "@FinancialTortoise", priority: 80 },
  { key: "cr",   name: "Concerning Reality",       handle: "@concerningreality",     priority: 70 },
  { key: "btb",  name: "BeatTheBush",              handle: "@BeatTheBush",           priority: 60 },
  { key: "rose", name: "Rose Han",                 handle: "@itsrosehan",            priority: 50 },
  { key: "dfm",  name: "Debt Free Millennials",    handle: "@DebtFreeMillennials",   priority: 40 },
  { key: "mkm",  name: "Marriage Kids and Money",  handle: "@MarriageKidsandMoney",  priority: 40 },
];

// ─── Concepts ────────────────────────────────────────────────────────────────
type Concept = {
  slug: string;
  label: string;
  headline: string;
  titleMatch: RegExp;    // used against channel video titles
  keywords: RegExp;      // used against transcript for density scoring
};

const CONCEPTS: Concept[] = [
  {
    slug: "compound-interest",
    label: "Compound interest",
    headline: "Compound interest explained",
    titleMatch: /\bcompound(ing)?\b|\brule of 72\b/i,
    keywords: /\b(compound|interest|principal|reinvest|snowball|exponential|doubles?|earns?\b.*interest)\b/i,
  },
  {
    slug: "inflation-cash-loses-value",
    label: "Inflation (why cash loses value)",
    headline: "Inflation explained",
    titleMatch: /\binflation\b/i,
    keywords: /\b(inflation|purchasing power|prices? (?:rise|go up)|cost of living|money.*loses? value|erode)\b/i,
  },
  {
    slug: "assets-vs-liabilities",
    label: "Assets vs liabilities",
    headline: "Assets vs liabilities",
    titleMatch: /\bassets?\b.*\bliabilit/i,
    keywords: /\b(asset|liability|liabilities|puts? money in your pocket|takes? money out|cash flow)\b/i,
  },
  {
    slug: "good-debt-vs-bad-debt",
    label: "Good debt vs bad debt",
    headline: "Good debt vs bad debt",
    titleMatch: /\bgood\b.*\bdebt\b|\bdebt\b.*\bgood\b|\bbad debt\b|\bgood debt\b/i,
    keywords: /\b(good debt|bad debt|leverage|appreciat|depreciat|mortgage|credit card debt|consumer debt)\b/i,
  },
  {
    slug: "net-worth-explained",
    label: "Net worth explained",
    headline: "Net worth explained",
    titleMatch: /\bnet worth\b|\bnetworth\b/i,
    keywords: /\b(net worth|assets minus liabilities|total assets|owe|own|balance sheet)\b/i,
  },
  {
    slug: "emergency-fund",
    label: "Emergency fund (why and how much)",
    headline: "Emergency fund explained",
    titleMatch: /\bemergency fund\b|\brainy day\b|\bsavings? cushion\b|\bfinancial safety net\b/i,
    keywords: /\b(emergency fund|three to six months|3 to 6 months|rainy day|savings|expenses|cushion|safety net)\b/i,
  },
  {
    slug: "how-credit-scores-work",
    label: "How credit scores work",
    headline: "Credit scores explained",
    titleMatch: /\bcredit score(s)?\b|\bfico\b|\bcredit (?:report|utilization|history)\b/i,
    keywords: /\b(credit score|fico|credit report|utilization|payment history|credit bureau|lender)\b/i,
  },
  {
    slug: "pay-yourself-first",
    label: "Needs vs wants / paying yourself first",
    headline: "Pay yourself first",
    titleMatch: /\bpay yourself first\b|\bpays you first\b|\breverse budget/i,
    keywords: /\b(pay yourself first|needs vs wants|budget|savings? rate|automate|before you spend)\b/i,
  },
];

const RED_FLAGS = [
  /\b(guaranteed returns?|can't lose|risk[- ]free (?:returns?|profits?))\b/i,
  /\b(get rich quick|overnight (?:millionaire|riches))\b/i,
  /\b(passive income (?:machine|hack))\b/i,
  /\b(use (?:my|our) (?:link|promo|code))\b/i,
];

// ─── shell helper ────────────────────────────────────────────────────────────
function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on("error", () => resolve({ code: -1, stdout, stderr: stderr + "\n[spawn error]" }));
  });
}

// Firefox live cookies — see lib/ytdlp-cookies.ts for rationale.
const cookieArgs = ["--cookies-from-browser", "firefox"];

// ─── Channel uploads listing (cached) ────────────────────────────────────────
type UploadRow = { id: string; title: string; duration: number };

async function listChannelUploads(channel: Channel): Promise<UploadRow[]> {
  const cachePath = join(CHAN_CACHE, `${channel.key}.tsv`);
  if (existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < 6 * 3600_000) {
    return readCache(cachePath);
  }
  console.log(`    fetching uploads for ${channel.name} (${channel.handle}) ...`);
  const url = `https://www.youtube.com/${channel.handle}/videos`;
  const res = await run("yt-dlp", [
    ...cookieArgs,
    "--flat-playlist",
    "--playlist-end", "300",
    "--print", "%(id)s\t%(title)s\t%(duration)s",
    "--no-warnings",
    url,
  ], { timeoutMs: 180_000 });
  if (res.code !== 0 && !res.stdout.trim()) {
    console.log(`    ⚠ channel list failed: ${res.stderr.slice(-300)}`);
    return [];
  }
  const rows: UploadRow[] = res.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [id, title, dur] = line.split("\t");
      return { id, title: title || "", duration: Number(dur) || 0 };
    })
    .filter((r) => r.id);
  writeFileSync(cachePath, rows.map((r) => `${r.id}\t${r.title}\t${r.duration}`).join("\n"), "utf8");
  return rows;
}

function readCache(path: string): UploadRow[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const [id, title, dur] = line.split("\t");
    return { id, title: title || "", duration: Number(dur) || 0 };
  });
}

// ─── Per-video subtitle fetch ────────────────────────────────────────────────
async function fetchSubsForVideo(videoId: string, cacheDir: string): Promise<{ vtt?: string; info?: any }> {
  mkdirSync(cacheDir, { recursive: true });
  const infoPath = join(cacheDir, `${videoId}.info.json`);
  const existingVtt = readdirSync(cacheDir).find((f) => f.startsWith(`${videoId}.`) && f.endsWith(".vtt"));
  if (existsSync(infoPath) && existingVtt) {
    return { vtt: join(cacheDir, existingVtt), info: JSON.parse(readFileSync(infoPath, "utf8")) };
  }
  const res = await run("yt-dlp", [
    ...cookieArgs,
    "--skip-download",
    "--write-info-json",
    "--write-auto-subs",
    "--write-subs",
    "--sub-langs", "en.*",
    "--sub-format", "vtt",
    "--no-playlist",
    "--ignore-errors",
    "-o", join(cacheDir, "%(id)s.%(ext)s"),
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeoutMs: 120_000 });
  const vtt = readdirSync(cacheDir).find((f) => f.startsWith(`${videoId}.`) && f.endsWith(".vtt"));
  const info = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, "utf8")) : undefined;
  if (!vtt && !info) console.log(`      ⚠ sub fetch failed for ${videoId}: ${res.stderr.slice(-200)}`);
  return { vtt: vtt ? join(cacheDir, vtt) : undefined, info };
}

// ─── VTT parsing ─────────────────────────────────────────────────────────────
type Cue = { start: number; end: number; text: string };

function parseTs(s: string): number {
  const m = s.match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) return NaN;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

function parseVtt(path: string): Cue[] {
  const raw = readFileSync(path, "utf8");
  const cues: Cue[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const tsLine = lines.find((l) => l.includes("-->"));
    if (!tsLine) continue;
    const [a, b] = tsLine.split("-->").map((s) => s.trim().split(" ")[0]);
    const start = parseTs(a); const end = parseTs(b);
    if (!isFinite(start) || !isFinite(end)) continue;
    const text = lines
      .filter((l) => !l.includes("-->") && !/^\d+$/.test(l) && !l.startsWith("WEBVTT") && !l.startsWith("NOTE") && !l.startsWith("Kind:") && !l.startsWith("Language:"))
      .join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (cues.length && cues[cues.length - 1].text === text) { cues[cues.length - 1].end = end; continue; }
    cues.push({ start, end, text });
  }
  return cues;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
type Score = { score: number; reason: string; window?: { start: number; end: number; cues: Cue[] }; rejected?: string };

function scoreCandidate(info: any, cues: Cue[], concept: Concept): Score {
  const title: string = info?.title || "";
  const desc: string = info?.description || "";
  const fullText = cues.map((c) => c.text).join(" ");

  for (const rx of RED_FLAGS) {
    if (rx.test(title) || rx.test(desc) || rx.test(fullText)) {
      return { score: -Infinity, reason: `red-flag`, rejected: `red-flag ${rx.source}` };
    }
  }
  if (cues.length < 10) return { score: -1, reason: "no usable transcript" };

  const MAX_WIN = 118;
  const MIN_WIN = 45;
  let best: { start: number; end: number; hits: number; density: number; cues: Cue[]; text: string } | null = null;
  for (let i = 0; i < cues.length; i++) {
    let j = i;
    while (j < cues.length && cues[j].end - cues[i].start <= MAX_WIN) j++;
    if (j - 1 <= i) continue;
    const winStart = cues[i].start;
    const winEnd = cues[j - 1].end;
    const winDur = winEnd - winStart;
    if (winDur < MIN_WIN) continue;
    const winCues = cues.slice(i, j);
    const winText = winCues.map((c) => c.text).join(" ");
    const hits = (winText.match(new RegExp(concept.keywords.source, "gi")) || []).length;
    const density = hits / (winDur / 60);
    if (!best || density > best.density || (density === best.density && hits > best.hits)) {
      best = { start: winStart, end: winEnd, hits, density, cues: winCues, text: winText };
    }
  }
  if (!best || best.hits < 3) return { score: 0, reason: `keywords sparse (best hits=${best?.hits ?? 0})` };
  if (RED_FLAGS.some((rx) => rx.test(best!.text))) return { score: -Infinity, reason: "red-flag in window", rejected: "promo in window" };

  const dur = best.end - best.start;
  const lenBonus = dur >= 60 && dur <= 110 ? 5 : 0;
  const score = best.density * 10 + best.hits + lenBonus;
  return {
    score,
    reason: `hits=${best.hits} density=${best.density.toFixed(2)}/min dur=${dur.toFixed(0)}s`,
    window: { start: best.start, end: best.end, cues: best.cues },
  };
}

// ─── Segment download ────────────────────────────────────────────────────────
async function downloadSegment(videoId: string, start: number, end: number, dest: string): Promise<{ ok: boolean; note: string }> {
  const args = [
    ...cookieArgs,
    "--download-sections", `*${Math.floor(start)}-${Math.ceil(end)}`,
    "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "-o", dest,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  const res = await run("yt-dlp", args, { timeoutMs: 300_000 });
  if (res.code === 0 && existsSync(dest) && statSync(dest).size > 100_000) return { ok: true, note: "section-download 1080p" };

  console.log(`    section download failed; falling back to full download + trim`);
  const fullPath = dest.replace(/\.mp4$/, "_full.mp4");
  const full = await run("yt-dlp", [
    ...cookieArgs,
    "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "-o", fullPath,
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeoutMs: 900_000 });
  if (full.code !== 0 || !existsSync(fullPath)) return { ok: false, note: `download failed: ${(full.stderr || res.stderr).slice(-300)}` };
  const trim = await run("ffmpeg", [
    "-y", "-ss", String(start), "-to", String(end), "-i", fullPath, "-c", "copy", dest,
  ], { timeoutMs: 120_000 });
  try { rmSync(fullPath); } catch {}
  if (trim.code !== 0) return { ok: false, note: `trim failed: ${trim.stderr.slice(-300)}` };
  return { ok: true, note: "full-download + trim (fallback) 1080p" };
}

// ─── Letterbox + hook (no captions) ─────────────────────────────────────────
async function repurpose(input: string, output: string, headline: string, dur: number): Promise<{ ok: boolean; err?: string }> {
  const txtPath = input.replace(/\.mp4$/, "_headline.txt");
  const fit = fitHeadline(headline);
  writeFileSync(txtPath, fit.lines.join("\n"), "utf8");
  const args = buildTreatmentArgs({
    source: input,
    output,
    orientation: "letterboxed",
    clipStart: 0,
    clipDuration: dur,
    watermarkPath: BRAND.watermark,
    headline,
    vernavleTtf: BRAND.vernavleTtf,
    fontsDir: BRAND.fontsDir,
    headlineTextfilePath: txtPath,
    headlineFontsize: fit.fontsize,
    headlineLineCount: fit.lines.length,
  });
  const res = await runFfmpeg(args);
  try { rmSync(txtPath); } catch {}
  if (res.code !== 0) return { ok: false, err: res.stderr.slice(-500) };
  return { ok: true };
}

// ─── Report ──────────────────────────────────────────────────────────────────
function appendReport(section: string) {
  if (!existsSync(REPORT_PATH)) {
    writeFileSync(REPORT_PATH, `# money-simplified run report\n\nGenerated: ${new Date().toISOString()}\nSources: ${CHANNELS.map((c) => c.name).join(", ")}\n\n`, "utf8");
  }
  appendFileSync(REPORT_PATH, section + "\n", "utf8");
}

// ─── Per-concept flow ────────────────────────────────────────────────────────
type Picked = { videoId: string; title: string; channel: string; url: string; start: number; end: number; score: number; reason: string; downloadNote: string; cues: Cue[] };

async function runConcept(concept: Concept): Promise<void> {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`▶ ${concept.label}  (${concept.slug})`);

  let picked: Picked | undefined;
  const rejects: string[] = [];

  for (const channel of [...CHANNELS].sort((a, b) => b.priority - a.priority)) {
    console.log(`  channel: ${channel.name}`);
    const uploads = await listChannelUploads(channel);
    if (uploads.length === 0) { console.log(`    (no uploads listed)`); continue; }
    const matches = uploads.filter((u) => concept.titleMatch.test(u.title));
    console.log(`    ${uploads.length} uploads, ${matches.length} title-match: ${matches.slice(0, 5).map((m) => `[${m.id}] ${m.title.slice(0, 50)}`).join(" | ")}`);
    if (matches.length === 0) continue;

    // Cap to top 5 shortest matches (concept clips are typically <15min)
    const top = matches.sort((a, b) => a.duration - b.duration).slice(0, 5);

    type Cand = { info: any; score: Score };
    const cands: Cand[] = [];
    const subCacheDir = join(TMP, `subs_${channel.key}`);
    for (const m of top) {
      const { vtt, info } = await fetchSubsForVideo(m.id, subCacheDir);
      if (!info) { cands.push({ info: { id: m.id, title: m.title }, score: { score: -1, reason: "no info" } }); continue; }
      if (!vtt) { cands.push({ info, score: { score: -1, reason: "no subs" } }); continue; }
      const cues = parseVtt(vtt);
      const s = scoreCandidate(info, cues, concept);
      cands.push({ info, score: s });
    }
    cands.sort((a, b) => b.score.score - a.score.score);
    for (const c of cands) {
      const marker = c.score.rejected ? "✗" : c.score.score > 0 ? "✓" : "·";
      console.log(`    ${marker} [${c.info.id}] ${c.score.score.toFixed(2).padStart(7)}  ${c.score.reason}  — ${String(c.info.title).slice(0, 70)}`);
      if (c.score.rejected) rejects.push(`${c.info.id}: ${c.score.rejected}`);
    }
    const top1 = cands.find((c) => c.score.window && c.score.score > 4);
    if (top1) {
      picked = {
        videoId: top1.info.id,
        title: top1.info.title,
        channel: channel.name,
        url: top1.info.webpage_url || `https://www.youtube.com/watch?v=${top1.info.id}`,
        start: top1.score.window!.start,
        end: top1.score.window!.end,
        score: top1.score.score,
        reason: top1.score.reason,
        downloadNote: "",
        cues: top1.score.window!.cues,
      };
      break;
    }
    console.log(`    no candidate from ${channel.name} cleared the bar; trying next channel`);
  }

  if (!picked) {
    console.log(`  ⊘ skip: no candidate cleared bar across channels`);
    appendReport(`## ${concept.label}\nslug: \`${concept.slug}\`\n\n- **SKIPPED** — no candidate cleared bar across channels${rejects.length ? ` (rejects: ${rejects.slice(0, 3).join("; ")})` : ""}\n`);
    return;
  }

  console.log(`  ✓ picked ${picked.videoId} from ${picked.channel} [${picked.start.toFixed(0)}-${picked.end.toFixed(0)}s] score=${picked.score.toFixed(2)}`);

  const segPath = join(TMP, `${concept.slug}_seg.mp4`);
  if (existsSync(segPath)) rmSync(segPath);
  const dl = await downloadSegment(picked.videoId, picked.start, picked.end, segPath);
  if (!dl.ok) {
    console.log(`  ⊘ download failed: ${dl.note}`);
    appendReport(`## ${concept.label}\nslug: \`${concept.slug}\`\n\n- **SKIPPED** — download failed: ${dl.note}\n`);
    return;
  }
  picked.downloadNote = dl.note;
  console.log(`  ✓ downloaded (${dl.note})`);

  const outPath = join(OUT_DIR, `${concept.slug}.mp4`);
  if (existsSync(outPath)) rmSync(outPath);
  const dur = picked.end - picked.start;
  const rep = await repurpose(segPath, outPath, concept.headline, dur);
  try { rmSync(segPath); } catch {}
  if (!rep.ok) {
    console.log(`  ⊘ ffmpeg failed: ${rep.err}`);
    appendReport(`## ${concept.label}\nslug: \`${concept.slug}\`\n\n- **SKIPPED** — ffmpeg failed\n`);
    return;
  }
  console.log(`  ✓ wrote outputs/money-simplified/${concept.slug}.mp4`);
  appendReport([
    `## ${concept.label}`,
    `slug: \`${concept.slug}\``,
    ``,
    `- **Source**: [${picked.title}](${picked.url})`,
    `- **Channel**: ${picked.channel}`,
    `- **Window**: ${picked.start.toFixed(1)}s – ${picked.end.toFixed(1)}s (${dur.toFixed(1)}s)`,
    `- **Score**: ${picked.score.toFixed(2)} — ${picked.reason}`,
    `- **Download**: ${picked.downloadNote}`,
    `- **Output**: \`outputs/money-simplified/${concept.slug}.mp4\``,
    ``,
  ].join("\n"));
}

async function main() {
  const argv = process.argv.slice(2);
  const targets = argv.length > 0 ? CONCEPTS.filter((c) => argv.includes(c.slug)) : CONCEPTS;
  if (argv.length && targets.length === 0) {
    console.error(`No matching concepts. Available: ${CONCEPTS.map((c) => c.slug).join(", ")}`);
    process.exit(1);
  }
  for (const c of targets) await runConcept(c);
  console.log(`\nDone. Report: outputs/money-simplified/run-report.md`);
}

main().catch((err) => { console.error(err); process.exit(1); });
