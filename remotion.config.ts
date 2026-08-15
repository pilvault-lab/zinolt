import { Config } from "@remotion/cli/config";
import path from "node:path";

// CLI renders can set *_ONLY=1 to bundle a single composition family.
// Avoids unrelated sibling comps (Reel, tweet, wire-carousel …) whose
// module-load `delayRender` calls can hang a long video render.
const entry =
  process.env.RANKING_ONLY === "1"
    ? "./remotion/ranking-only.tsx"
    : process.env.CONCEPT_REEL_ONLY === "1"
    ? "./remotion/concept-reel-only.tsx"
    : "./remotion/index.ts";
Config.setEntryPoint(entry);
Config.setPublicDir("./public");
Config.setVideoImageFormat("jpeg");

// Match Next.js path alias so shared libs (lib/**, components/**) resolve
// under the Remotion CLI bundler too.
Config.overrideWebpackConfig((cfg) => ({
  ...cfg,
  resolve: {
    ...cfg.resolve,
    alias: {
      ...(cfg.resolve?.alias ?? {}),
      "@": path.resolve(process.cwd()),
    },
  },
}));
