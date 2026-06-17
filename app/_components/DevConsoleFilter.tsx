"use client";

import { useEffect } from "react";

// Substrings of upstream library messages we suppress in dev only.
// Currently: mediabunny's "VideoSample was garbage collected" warning fired
// from inside @remotion/media's preview decoder during HMR / rapid prop
// updates. It's a resource-hygiene warning that doesn't affect exports.
const SUPPRESSED = ["A VideoSample was garbage collected"];

const shouldSuppress = (args: unknown[]): boolean =>
  args.some(
    (a) =>
      typeof a === "string" && SUPPRESSED.some((s) => a.includes(s)),
  );

export const DevConsoleFilter: React.FC = () => {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = (...args: unknown[]) => {
      if (shouldSuppress(args)) return;
      origWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      if (shouldSuppress(args)) return;
      origError(...args);
    };
    return () => {
      console.warn = origWarn;
      console.error = origError;
    };
  }, []);
  return null;
};
