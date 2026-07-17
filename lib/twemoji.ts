// Twemoji SVG mapping. Assets served from jsDelivr — we don't bundle the
// ~10MB SVG set into the repo. Remotion's <Img> delayRender()s until the
// URL resolves, so this is transparent at render time.
//
// Uses jdecked/twemoji (the maintained fork — Twitter's original repo is
// archived at 14.0.2 and lacks Unicode 15+ emojis like 🩵 1fa75). 15.1.0
// covers everything through Unicode 15.1.
const CDN_BASE =
  "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg";

export type Segment =
  | { type: "text"; value: string }
  | { type: "emoji"; codepoint: string; url: string };

// Match one emoji cluster: pictographic base + optional ZWJ chains,
// variation selector, and skin-tone modifiers.
const EMOJI_RE =
  /\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*[️\u{1F3FB}-\u{1F3FF}]*/gu;

function codepointFilename(cluster: string): string {
  const cps = Array.from(cluster).map((ch) =>
    ch.codePointAt(0)!.toString(16),
  );
  // Twemoji filenames strip fe0f from single-cluster codepoints to match
  // the way twitter.github.io/twemoji names files.
  if (cps.length === 2 && cps[1] === "fe0f") {
    return cps[0];
  }
  return cps.join("-");
}

export function twemojiUrl(codepoint: string): string {
  return `${CDN_BASE}/${codepoint}.svg`;
}

export function splitTwemoji(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(EMOJI_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      segments.push({ type: "text", value: text.slice(last, idx) });
    }
    const codepoint = codepointFilename(match[0]);
    segments.push({
      type: "emoji",
      codepoint,
      url: twemojiUrl(codepoint),
    });
    last = idx + match[0].length;
  }
  if (last < text.length) {
    segments.push({ type: "text", value: text.slice(last) });
  }
  return segments;
}
