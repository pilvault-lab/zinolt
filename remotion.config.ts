import { Config } from "@remotion/cli/config";
import path from "node:path";

Config.setEntryPoint("./remotion/index.ts");
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
