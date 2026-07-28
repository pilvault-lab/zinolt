import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The reel-safe submit route reads scripts/reel-safe-pipeline.mjs at runtime
  // to ship into the Vercel Sandbox. Include it in the function trace so it's
  // available on serverless — Next.js can't detect this dynamic fs.readFile.
  outputFileTracingIncludes: {
    "/api/reel-safe": ["./scripts/reel-safe-pipeline.mjs"],
  },
  async headers() {
    return [
      {
        // Ray video is static — cache it hard. Fallback if the
        // ERR_CACHE_OPERATION_NOT_SUPPORTED quirk on Range requests
        // (mediabunny inside @remotion/media) ever reappears on a real
        // CDN: revert to `no-store`. It was a dev-server + Chrome disk
        // cache interaction, so production shouldn't hit it.
        source: "/rays/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
