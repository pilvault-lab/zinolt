import type React from "react";
import { ArtistFeatureLayout } from "@/components/slides/layouts/ArtistFeatureLayout";
import { OpenCallLayout } from "@/components/slides/layouts/OpenCallLayout";
import { QuoteLayout } from "@/components/slides/layouts/QuoteLayout";

export type FieldKind = "text" | "image";

export type Field = {
  key: string;
  kind: FieldKind;
  label: string;
  placeholder?: string;
  multiline?: boolean;
};

export type SlideValues = Record<string, string>;

/** Per-slide typography overrides exposed via the studio's font controls. */
export type SlideTypography = {
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  /** Letter spacing in em (e.g. 0, -0.02, 0.05). */
  letterSpacing?: number;
};

export type LayoutRenderProps<V extends SlideValues = SlideValues> = {
  values: V;
  typography?: SlideTypography;
};

export type SlideLayout = {
  id: string;
  label: string;
  fields: readonly Field[];
  Render: React.ComponentType<LayoutRenderProps>;
};

export const SLIDE_LAYOUTS: readonly SlideLayout[] = [
  {
    id: "artist-feature",
    label: "Artist feature",
    fields: [
      {
        key: "portrait",
        kind: "image",
        label: "Portrait",
        placeholder: "Square photo of the artist",
      },
      {
        key: "artwork",
        kind: "image",
        label: "Artwork",
        placeholder: "The hero piece",
      },
      {
        key: "name",
        kind: "text",
        label: "Name",
        placeholder: "Alex Marin",
      },
      {
        key: "descriptor",
        kind: "text",
        label: "Descriptor",
        placeholder: "Ceramicist · Mexico City",
      },
    ],
    Render: ArtistFeatureLayout,
  },
  {
    id: "open-call",
    label: "Open call",
    fields: [
      {
        key: "title",
        kind: "text",
        label: "Title",
        placeholder: "Open call: Summer issue",
      },
      {
        key: "brief",
        kind: "text",
        label: "Brief",
        placeholder: "Short description of the call…",
        multiline: true,
      },
      {
        key: "deadline",
        kind: "text",
        label: "Deadline",
        placeholder: "August 14",
      },
      {
        key: "prize",
        kind: "text",
        label: "Prize",
        placeholder: "$2,500 + feature",
      },
      {
        key: "image",
        kind: "image",
        label: "Supporting image",
        placeholder: "Visual support",
      },
    ],
    Render: OpenCallLayout,
  },
  {
    id: "quote",
    label: "Quote",
    fields: [
      {
        key: "quote",
        kind: "text",
        label: "Quote",
        placeholder: "A piece of clay only knows…",
        multiline: true,
      },
    ],
    Render: QuoteLayout,
  },
] as const;

export const DEFAULT_LAYOUT_ID = SLIDE_LAYOUTS[0].id;

export const getLayout = (id: string | null | undefined): SlideLayout =>
  SLIDE_LAYOUTS.find((l) => l.id === id) ?? SLIDE_LAYOUTS[0];
