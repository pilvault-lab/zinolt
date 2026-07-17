import type { FetchedTweet } from "@/lib/tweet-fetch";

export type CardTheme = "light" | "dark";

export type BackgroundConfig =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; angle: number; from: string; to: string }
  | { kind: "loop"; src: string }
  | { kind: "upload"; src: string };

export interface CardIdentity {
  name: string;
  handle: string;
  avatarUrl: string;
  verified: boolean;
}

export interface TweetCardProps {
  tweet: FetchedTweet;
  identity: CardIdentity;
  theme: CardTheme;
  showStats: boolean;
  showTimestamp: boolean;
  showVerifiedBadge: boolean;
  inCardMedia: boolean;
  maxWidthPx: number;
  cornerRadius: number;
  fontScale?: number;
  forRender?: boolean;
}

export type Aspect = "9x16" | "1x1" | "16x9";
