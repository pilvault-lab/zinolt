export type Template = {
  id: string;
  compositionId: string;
  label: string;
  background: string;
  preview: string;
  href?: string;
};

export const TEMPLATES: readonly Template[] = [
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
    id: "letterbox",
    compositionId: "LetterboxReel",
    label: "Letterbox Card",
    background: "",
    preview: "/letterbox-card-empty.png",
  },
] as const;

export const DEFAULT_TEMPLATE_ID = TEMPLATES[0].id;

export const getTemplate = (id: string | null | undefined): Template =>
  TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
