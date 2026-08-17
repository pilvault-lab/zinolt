export type Template = {
  id: string;
  compositionId: string;
  label: string;
  background: string;
  preview: string;
  href?: string;
};

/* Archived — kept in source so the routes / Remotion compositions still
 * work directly, but hidden from the homepage grid. Restore by moving an
 * entry back into TEMPLATES. */
export const ARCHIVED_TEMPLATES: readonly Template[] = [
  {
    id: "light-ray",
    compositionId: "LightRay",
    label: "Light Ray",
    background: "/rays/light-ray-white.mp4",
    preview: "/rays/light-ray-white.mp4",
  },
  {
    id: "ferrofluid",
    compositionId: "Ferrofluid",
    label: "Ferrofluid",
    background: "/rays/ferrofluid-white.mp4",
    preview: "/rays/ferrofluid-white.mp4",
  },
  {
    id: "light-pillar",
    compositionId: "LightPillar",
    label: "Light Pillar",
    background: "/rays/light-pillar-white-v3.mp4",
    preview: "/rays/light-pillar-white-v3.mp4",
  },
  {
    id: "lanyard",
    compositionId: "Lanyard",
    label: "Lanyard Slides",
    background: "",
    preview: "/lanyard/lanyard-preview.svg",
    href: "/slides",
  },
  {
    id: "wall",
    compositionId: "WallSignage",
    label: "Wall Signage",
    background: "",
    preview: "/wall/wall-preview.svg",
    href: "/wall",
  },
  {
    id: "dangle",
    compositionId: "Dangle",
    label: "Dangle Card",
    background: "",
    preview: "/dangle/dangle-preview.svg",
    href: "/dangle",
  },
] as const;

export const TEMPLATES: readonly Template[] = [
  {
    id: "letterbox",
    compositionId: "LetterboxReel",
    label: "Letterbox Card",
    background: "",
    preview: "/letterbox-card-empty.png",
  },
  {
    id: "repurpose",
    compositionId: "",
    label: "Repurpose",
    background: "",
    preview: "/repurpose/preview.svg",
    href: "/repurpose",
  },
  {
    id: "frosted",
    compositionId: "FrostedCard",
    label: "Frosted Card",
    background: "",
    preview: "/frosted/frosted-preview.svg",
    href: "/frosted",
  },
  {
    id: "wire-carousel",
    compositionId: "",
    label: "Wire Carousel",
    background: "",
    preview: "/wire-carousel/preview.svg",
    href: "/wire-carousel",
  },
  {
    id: "tweet-video",
    compositionId: "TweetInCard9x16",
    label: "Tweet to Video",
    background: "",
    preview: "/tweet-video/preview.png",
    href: "/tweet-video",
  },
  {
    id: "reel-safe",
    compositionId: "",
    label: "Reel-Safe",
    background: "",
    preview: "/reel-safe/preview.svg",
    href: "/reel-safe",
  },
  {
    id: "time-machine",
    compositionId: "TimeMachine",
    label: "Time Machine",
    background: "",
    preview: "/time-machine/preview.svg",
    href: "/time-machine",
  },
  {
    id: "daily-movers",
    compositionId: "DailyMovers",
    label: "Daily Movers",
    background: "",
    preview: "/daily-movers/preview.svg",
    href: "/daily-movers",
  },
  {
    id: "clip-studio",
    compositionId: "",
    label: "Clip Studio",
    background: "",
    preview: "/clip-studio/preview.svg",
    href: "/clip-studio",
  },
  {
    id: "story-card",
    compositionId: "StoryCard",
    label: "Story Card",
    background: "",
    preview: "/story-card/preview.svg",
    href: "/story-card",
  },
  {
    id: "ranking",
    compositionId: "Ranking",
    label: "Ranking",
    background: "",
    preview: "/ranking/preview.svg",
    href: "/ranking",
  },
  {
    id: "concept-reel",
    compositionId: "ConceptReel",
    label: "Concept Reel",
    background: "",
    preview: "/concept-reel/preview.svg",
    href: "/concept-reel",
  },
  {
    id: "hype-edit",
    compositionId: "HypeEdit",
    label: "Hype Edit",
    background: "",
    preview: "/hype-edit/preview.svg",
    href: "/hype-edit",
  },
] as const;

export const DEFAULT_TEMPLATE_ID = TEMPLATES[0].id;

export const getTemplate = (id: string | null | undefined): Template => {
  const all = [...TEMPLATES, ...ARCHIVED_TEMPLATES];
  return all.find((t) => t.id === id) ?? TEMPLATES[0];
};
