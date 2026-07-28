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

// Shared defaults — both pages start with identical controls so a profile
// switch is purely an identity change.
const SHARED_DEFAULTS = {
  defaultTheme: "dark" as const,
  defaultBackground: {
    kind: "gradient" as const,
    angle: 135,
    from: "#0f172a",
    to: "#1e293b",
  },
  defaultAspect: "9x16" as const,
  defaultShowStats: false,
  defaultShowTimestamp: true,
  defaultShowVerifiedBadge: true,
};

export const PAGE_PROFILES: readonly PageProfile[] = [
  {
    id: "vernavle",
    displayName: "Vernavle",
    handle: "vernavle",
    avatarUrl: "/brand/jujui.jpg",
    verified: true,
    ...SHARED_DEFAULTS,
  },
] as const;

export const DEFAULT_PROFILE_ID = "vernavle";

export const getProfile = (id: string): PageProfile =>
  PAGE_PROFILES.find((p) => p.id === id) ?? PAGE_PROFILES[0];
