export type Template = {
  id: string;
  compositionId: string;
  label: string;
  background: string;
  preview: string;
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
] as const;

export const DEFAULT_TEMPLATE_ID = TEMPLATES[0].id;

export const getTemplate = (id: string | null | undefined): Template =>
  TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
