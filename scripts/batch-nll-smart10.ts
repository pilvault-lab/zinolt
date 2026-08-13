/**
 * Batch: NLL smart 10.
 *
 * For 10 curated Next Level Life videos:
 *   1. Fetch subs + info via yt-dlp (Firefox live cookies).
 *   2. Parse cues; mark CTA/subscribe cues as excluded.
 *   3. Find best 60–180s window that starts at a hook cue (question or
 *      strong opener) and ends at a sentence boundary (period, pause).
 *   4. Full-download source, letterbox+hook+watermark, output.
 *
 * Usage:
 *   npx tsx scripts/batch-nll-smart10.ts             # all 10
 *   npx tsx scripts/batch-nll-smart10.ts 01 03 07    # subset by number
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, appendFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brandAssetPaths, buildTreatmentArgs, fitHeadline, runFfmpeg } from "../lib/video-treatment";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "outputs", "money-simplified");
const TMP = join(tmpdir(), "zinolt-nll-smart10");
const SRC_CACHE = join(TMP, "sources");
const SUB_CACHE = join(TMP, "subs");
const REPORT = join(OUT_DIR, "nll-smart-run-report.md");
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(SRC_CACHE, { recursive: true });
mkdirSync(SUB_CACHE, { recursive: true });
const BRAND = brandAssetPaths(join(ROOT, "public"));

// Firefox live cookies — see lib/ytdlp-cookies.ts.
const cookieArgs = ["--cookies-from-browser", "firefox"];

type Clip = { n: string; videoId: string; hook: string; slug: string; sourceTitle: string };

const CLIPS: Clip[] = [
  { n: "01", videoId: "q63F1pBrUHA", hook: "How to legally never pay taxes",              slug: "legally-never-pay-taxes",  sourceTitle: "How to (Legally) Never Pay Taxes Again" },
  { n: "02", videoId: "kDSHHiFMJ_I", hook: "10 levels of financial independence",        slug: "10-levels-fi",             sourceTitle: "10 Levels of Financial Independence And Early Retirement" },
  { n: "03", videoId: "jlQ8UL1FsW4", hook: "How to buy a car (the 20/4/10 rule)",        slug: "how-to-buy-a-car",         sourceTitle: "How to Buy A Car | The 20/4/10 Rule Explained" },
  { n: "04", videoId: "LozYqnlIZQE", hook: "The 3 keys to financial independence",       slug: "3-keys-fi",                sourceTitle: "The 3 Keys to Financial Independence" },
  { n: "05", videoId: "4WQPyHxZGVE", hook: "The 3 stages of wealth creation",            slug: "3-stages-wealth",          sourceTitle: "The 3 Stages of Wealth Creation" },
  { n: "06", videoId: "8Jio9WumGLs", hook: "How much home can you afford",               slug: "how-much-home",            sourceTitle: "How Much Home Can You Afford? (The 30/30/3 Rule Explained)" },
  { n: "07", videoId: "MBuGJeNPX1I", hook: "The 3 types of millionaires",                slug: "3-types-millionaires",     sourceTitle: "The 3 Types of Millionaires (Which One Are You?)" },
  { n: "08", videoId: "XUvi9GKhXUU", hook: "How to retire by 30",                        slug: "retire-by-30",             sourceTitle: "How to Retire By 30 (The SHOCKINGLY SIMPLE Truth)" },
  { n: "09", videoId: "jOd0U2_n_zw", hook: "Rent vs buy: the SMORES rule",               slug: "rent-vs-buy-smores",       sourceTitle: "Demystifying the Rent Vs Buy Debate With The SMORES Rule" },
  { n: "10", videoId: "s07pbAnCwDY", hook: "Why everyone should be frugal",              slug: "why-be-frugal",            sourceTitle: "Why Everyone Should Be Frugal | The Truth About Frugality" },
];

// ─── shell helper ────────────────────────────────────────────────────────────
function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    child.on("error", () => resolve({ code: -1, stdout, stderr }));
  });
}

// ─── Subtitle fetch + VTT parse ──────────────────────────────────────────────
type Cue = { start: number; end: number; text: string };

async function fetchSubs(videoId: string): Promise<Cue[]> {
  const existing = readdirSync(SUB_CACHE).find((f) => f.startsWith(`${videoId}.`) && f.endsWith(".vtt"));
  let vttPath = existing ? join(SUB_CACHE, existing) : "";
  if (!vttPath) {
    const res = await run("yt-dlp", [
      ...cookieArgs,
      "--skip-download", "--write-auto-subs", "--write-subs",
      "--sub-langs", "en.*", "--sub-format", "vtt",
      "--no-playlist",
      "-o", join(SUB_CACHE, "%(id)s.%(ext)s"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeoutMs: 120_000 });
    const found = readdirSync(SUB_CACHE).find((f) => f.startsWith(`${videoId}.`) && f.endsWith(".vtt"));
    if (!found) throw new Error(`no subs for ${videoId}: ${res.stderr.slice(-200)}`);
    vttPath = join(SUB_CACHE, found);
  }
  return parseVtt(vttPath);
}

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

// ─── CTA + hook detection ────────────────────────────────────────────────────
const CTA_PATTERNS = [
  /\bsubscribe\b/i,
  /\bhit (?:that|the) (?:bell|like|subscribe)/i,
  /\blike this video\b/i,
  /\bleave a (?:like|comment)\b/i,
  /\blet me know in the comments?\b/i,
  /\bif you'?re new here\b/i,
  /\bcheck (?:out )?the description\b/i,
  /\blink(?:s)? (?:in|below|left) (?:in )?(?:the )?description\b/i,
  /\bin the description below\b/i,
  /\bnext level jumpstart\b/i,
  /\bnext level (?:podcast|show)\b/i,
  /\bpatreon\b/i,
  /\bbecome a (?:patron|member)\b/i,
  /\bjoin (?:us|me|the channel) on\b/i,
  /\bearly access to (?:new )?videos?\b/i,
  /\bwant to (?:further |truly )?support (?:this|the) channel\b/i,
  /\bhelp(?:s)? (?:out )?the channel\b/i,
  /\bcheck out (?:some of )?the links?\b/i,
  /\bbrought to you by\b/i,
  /\bsponsor(?:ed)? (?:of|by|this video)\b/i,
  /\bour sponsor\b/i,
  /\bthanks (?:for|to) (?:watching|our patrons)\b/i,
  /\btill next time\b/i,
  /\bsee you (?:in the )?next (?:one|video)\b/i,
  /\bbefore we get (?:going|started)\b/i,
  /\bnotifications on\b/i,
  /\bring the bell\b/i,
  // NLL-specific affiliate / promo phrasings
  /\bfree audiobooks?\b/i,
  /\brecommended platforms?\b/i,
  /\bget started investing for free\b/i,
  /\bmy recommended\b/i,
  /\bm1 finance\b/i,
  /\bpersonal capital\b/i,
  /\baudible\b/i,
  /\baffiliate\b/i,
  /\bcommission\b/i,
  /\bpromo code\b/i,
  /\bfree trial\b/i,
  /\bsign up (?:with|for|using)\b/i,
  /\bgo to (?:my|the) (?:website|link)\b/i,
  /\ba little bit of support (?:for|to) (?:the|our) channel\b/i,
  /\bhelps? (?:me|us|the channel) out\b/i,
  /\bcan (?:make|help) for your own personal financial\b/i,
  /\bmake for your own personal financial\b/i,
];

const HOOK_OPENERS = [
  /^(what|why|how|when|where|is|are|do|does|did|have|has|can|could|would|should|will|imagine|picture|consider|here'?s|most people|the truth|the reason|the problem|the biggest|the number|the secret|the answer)\b/i,
  /^(what if|have you ever|did you know|ever wonder|would you)\b/i,
  /^(there'?s a|there is a)\b/i,
];

function isCta(text: string): boolean {
  return CTA_PATTERNS.some((rx) => rx.test(text));
}

function hookStrength(text: string): number {
  let s = 0;
  if (HOOK_OPENERS.some((rx) => rx.test(text))) s += 5;
  if (/\?$/.test(text.trim())) s += 3;
  // Sentence-starting caps (auto captions usually don't have them, so weak signal)
  if (/^[A-Z]/.test(text)) s += 1;
  return s;
}

function endsSentence(text: string): boolean {
  return /[.!?]\s*$/.test(text.trim());
}

// ─── Window picker ───────────────────────────────────────────────────────────
type Window = { startIdx: number; endIdx: number; startSec: number; endSec: number; dur: number; score: number; reason: string };

function pickWindow(cues: Cue[]): Window | null {
  const MIN = 60;
  const MAX = 180;
  const TARGET = 90;
  const INTRO_SKIP = 5;
  const CTA_BUFFER = 3;  // seconds after CTA block ends before we start

  if (cues.length === 0) return null;
  const cta = cues.map((c) => isCta(c.text));
  const totalEnd = cues[cues.length - 1].end;

  // Locate the "early CTA block": last CTA in the first 60% of video.
  const earlyCutoff = totalEnd * 0.6;
  let earlyCtaEnd = 0;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].start > earlyCutoff) break;
    if (cta[i]) earlyCtaEnd = Math.max(earlyCtaEnd, cues[i].end);
  }
  const contentStart = Math.max(INTRO_SKIP, earlyCtaEnd + CTA_BUFFER);

  // Find first non-CTA cue at/after contentStart.
  let startIdx = cues.findIndex((c, i) => c.start >= contentStart && !cta[i]);
  if (startIdx === -1) return null;

  // Snap start forward to a natural audio boundary within the next 20s:
  // preferred: a cue starting with a capital letter, or a cue preceded by a
  // >=0.3s pause, or a hook opener. This avoids mid-sentence audio starts.
  const nudgeCap = cues[startIdx].start + 20;
  let snapped = startIdx;
  let bestSnapScore = -Infinity;
  for (let i = startIdx; i < cues.length && cues[i].start <= nudgeCap; i++) {
    if (cta[i]) continue;
    const prev = i > 0 ? cues[i - 1] : null;
    const gap = prev ? cues[i].start - prev.end : 999;
    const startsCap = /^[A-Z]/.test(cues[i].text.trim());
    const hookHere = hookStrength(cues[i].text);
    const score = (gap >= 0.5 ? 10 : gap >= 0.3 ? 6 : gap >= 0.15 ? 2 : 0)
                + (startsCap ? 8 : 0)
                + hookHere * 3
                - (cues[i].start - cues[startIdx].start) * 0.1; // slight preference for earlier
    if (score > bestSnapScore) { bestSnapScore = score; snapped = i; }
  }
  startIdx = snapped;
  const startSec = cues[startIdx].start;

  // Walk forward from startIdx until we hit a CTA or exceed MAX duration.
  // Choose the best end cue: prefer one that gives duration close to TARGET
  // AND ends on any natural break (sentence-final, ≥0.2s gap, or next starts capitalized).
  let bestEndIdx = -1;
  let bestScore = -Infinity;
  for (let j = startIdx; j < cues.length; j++) {
    if (cta[j]) break;
    const dur = cues[j].end - startSec;
    if (dur < MIN) continue;
    if (dur > MAX) break;
    const nextCue = cues[j + 1];
    const gap = nextCue ? nextCue.start - cues[j].end : 999;
    const nextCap = nextCue ? /^[A-Z]/.test(nextCue.text.trim()) : true;
    const naturalBreak = endsSentence(cues[j].text) || gap >= 0.2 || nextCap;
    // Score: closeness to target + natural-break bonus
    const distFromTarget = Math.abs(dur - TARGET);
    const score = -distFromTarget + (naturalBreak ? 20 : 0) + (endsSentence(cues[j].text) ? 15 : 0) + (gap >= 0.3 ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestEndIdx = j;
    }
  }

  if (bestEndIdx === -1) {
    // No cue lands in [MIN, MAX]. As last resort, take cues up to MAX or up to next CTA.
    for (let j = startIdx; j < cues.length; j++) {
      if (cta[j]) break;
      if (cues[j].end - startSec >= TARGET) { bestEndIdx = j; break; }
    }
  }
  if (bestEndIdx === -1) return null;

  const endSec = cues[bestEndIdx].end;
  const dur = endSec - startSec;
  const startHook = hookStrength(cues[startIdx].text);
  return {
    startIdx, endIdx: bestEndIdx, startSec, endSec, dur,
    score: bestScore,
    reason: `contentStart=${contentStart.toFixed(0)}s hook=${startHook} dur=${dur.toFixed(0)}s`,
  };
}

// ─── Download + repurpose ────────────────────────────────────────────────────
async function downloadFull(videoId: string): Promise<{ ok: boolean; path?: string; err?: string }> {
  const dest = join(SRC_CACHE, `${videoId}.mp4`);
  if (existsSync(dest) && statSync(dest).size > 500_000) return { ok: true, path: dest };
  const res = await run("yt-dlp", [
    ...cookieArgs,
    "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "-o", dest,
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeoutMs: 900_000 });
  if (res.code === 0 && existsSync(dest) && statSync(dest).size > 500_000) return { ok: true, path: dest };
  return { ok: false, err: res.stderr.slice(-400) };
}

async function repurpose(input: string, output: string, hook: string, start: number, dur: number): Promise<{ ok: boolean; err?: string }> {
  const txtPath = join(TMP, `${Buffer.from(output).toString("hex").slice(0, 8)}_hook.txt`);
  const fit = fitHeadline(hook);
  writeFileSync(txtPath, fit.lines.join("\n"), "utf8");
  const args = buildTreatmentArgs({
    source: input, output,
    orientation: "letterboxed",
    clipStart: start, clipDuration: dur,
    watermarkPath: BRAND.watermark,
    headline: hook,
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

function appendReport(section: string) {
  if (!existsSync(REPORT)) {
    writeFileSync(REPORT, `# NLL smart 10 run report\n\nGenerated: ${new Date().toISOString()}\nSource: Next Level Life (@NextLevelLife)\nWindow strategy: transcript-driven hook→sentence-end, CTA-excluded, 60–180s target\n\n`, "utf8");
  }
  appendFileSync(REPORT, section + "\n", "utf8");
}

async function runClip(c: Clip): Promise<void> {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`▶ [${c.n}] ${c.hook}  (${c.slug})`);
  console.log(`  video: https://youtu.be/${c.videoId}`);

  let cues: Cue[] = [];
  try {
    cues = await fetchSubs(c.videoId);
    console.log(`  ✓ ${cues.length} cues parsed`);
  } catch (e) {
    console.log(`  ⚠ no subs available (${(e as Error).message.slice(0, 60)}) — using fixed fallback window`);
  }

  let win = pickWindow(cues);
  if (!win) {
    // Fallback: skip past NLL's typical CTA block (~130s in) and take 90s.
    const FALLBACK_START = 135;
    const FALLBACK_DUR = 90;
    win = {
      startIdx: -1, endIdx: -1,
      startSec: FALLBACK_START, endSec: FALLBACK_START + FALLBACK_DUR,
      dur: FALLBACK_DUR, score: -999,
      reason: `fixed fallback window (no usable subs)`,
    };
    console.log(`  ⚠ using fallback window ${FALLBACK_START}-${FALLBACK_START + FALLBACK_DUR}s`);
  }
  const startTxt = win.startIdx >= 0 ? cues[win.startIdx].text : "(fallback — no subs)";
  const endTxt = win.endIdx >= 0 ? cues[win.endIdx].text : "(fallback — no subs)";
  console.log(`  ✓ window ${win.startSec.toFixed(1)}-${win.endSec.toFixed(1)}s (${win.dur.toFixed(1)}s) score=${win.score.toFixed(1)}`);
  console.log(`    start cue: "${startTxt.slice(0, 80)}"`);
  console.log(`    end cue:   "${endTxt.slice(0, 80)}"`);
  console.log(`    reason: ${win.reason}`);

  const dl = await downloadFull(c.videoId);
  if (!dl.ok) {
    console.log(`  ⊘ download failed: ${dl.err}`);
    appendReport(`## ${c.n}. ${c.hook}\n\n- **SKIPPED** — download failed\n`);
    return;
  }
  console.log(`  ✓ source ready (${(statSync(dl.path!).size / 1e6).toFixed(1)} MB)`);

  const outName = `nll-${c.n}-${c.slug}.mp4`;
  const outPath = join(OUT_DIR, outName);
  if (existsSync(outPath)) rmSync(outPath);
  const rep = await repurpose(dl.path!, outPath, c.hook, win.startSec, win.dur);
  if (!rep.ok) {
    console.log(`  ⊘ ffmpeg failed: ${rep.err}`);
    appendReport(`## ${c.n}. ${c.hook}\n\n- **SKIPPED** — ffmpeg failed\n`);
    return;
  }
  console.log(`  ✓ wrote outputs/money-simplified/${outName}`);
  appendReport([
    `## ${c.n}. ${c.hook}`,
    `slug: \`${c.slug}\``,
    ``,
    `- **Source**: [${c.sourceTitle}](https://youtu.be/${c.videoId})`,
    `- **Window**: ${win.startSec.toFixed(1)}s – ${win.endSec.toFixed(1)}s (${win.dur.toFixed(1)}s)`,
    `- **Start cue**: "${startTxt.slice(0, 140)}"`,
    `- **End cue**: "${endTxt.slice(0, 140)}"`,
    `- **Picker**: ${win.reason}`,
    `- **Output**: \`outputs/money-simplified/${outName}\``,
    ``,
  ].join("\n"));
}

async function main() {
  const argv = process.argv.slice(2);
  const targets = argv.length > 0 ? CLIPS.filter((c) => argv.includes(c.n)) : CLIPS;
  if (argv.length && targets.length === 0) {
    console.error(`No matching. Numbers: ${CLIPS.map((c) => c.n).join(", ")}`);
    process.exit(1);
  }
  for (const c of targets) await runClip(c);
  console.log(`\nDone. Report: outputs/money-simplified/nll-smart-run-report.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
