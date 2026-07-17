import type { BackgroundConfig } from "@/remotion/tweet/types";

export interface PageProfile {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  verified: boolean;
  defaultTheme: "light" | "dark";
  defaultBackground: BackgroundConfig;
  defaultAspect: "9x16" | "1x1" | "16x9";
  defaultShowStats: boolean;
  defaultShowTimestamp: boolean;
  defaultShowVerifiedBadge: boolean;
}

export const PAGE_PROFILES: readonly PageProfile[] = [
  {
    id: "general",
    displayName: "General Page",
    handle: "general_page",
    avatarUrl: "/pages/general/avatar.jpg",
    verified: false,
    defaultTheme: "dark",
    defaultBackground: {
      kind: "gradient",
      angle: 135,
      from: "#0f172a",
      to: "#1e293b",
    },
    defaultAspect: "9x16",
    defaultShowStats: false,
    defaultShowTimestamp: true,
    defaultShowVerifiedBadge: false,
  },
  {
    id: "fintech",
    displayName: "Fintech Page",
    handle: "fintech_page",
    avatarUrl: "/pages/fintech/avatar.jpg",
    verified: true,
    defaultTheme: "light",
    defaultBackground: { kind: "solid", color: "#f8fafc" },
    defaultAspect: "9x16",
    defaultShowStats: false,
    defaultShowTimestamp: true,
    defaultShowVerifiedBadge: true,
  },
] as const;

export const DEFAULT_PROFILE_ID = "general";

export const getProfile = (id: string): PageProfile =>
  PAGE_PROFILES.find((p) => p.id === id) ?? PAGE_PROFILES[0];
