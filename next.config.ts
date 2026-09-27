import type { NextConfig } from "next";

const stealthRoutes = [
  "/api/cron/monitor",
  "/api/targets",
  "/api/targets/bulk",
  "/api/targets/resolve",
  "/api/targets/\\[id\\]",
  "/api/targets/\\[id\\]/check",
  "/api/sessions",
  "/api/sessions/test",
  "/api/sessions/login",
  "/api/meta/status",
  "/api/health",
  "/api/media/\\[id\\]/redownload",
  "/api/media/\\[id\\]/repost",
  "/api/cron/cleanup",
  "/api/niche",
  "/api/niche/accounts",
  "/api/niche/suggestions",
];

// Routes that spawn ffmpeg. They need the binary and the caption font shipped
// with the function; neither is reachable through a static import the tracer follows.
const renderRoutes = [
  "/api/dev/render-test",
  "/api/dev/voice-test",
  "/api/cron/reels",
  "/api/ideas/\\[id\\]",
  "/api/reels/\\[id\\]/retry",
  "/api/reels/\\[id\\]/advance",
  "/api/reels/\\[id\\]/regenerate",
  "/api/sounds",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["got-scraping", "header-generator", "@dryft/tlsclient", "ffi-rs", "workerpool", "ffmpeg-static"],
  outputFileTracingIncludes: {
    ...Object.fromEntries(stealthRoutes.map((route) => [route, ["lib/native/**/*"]])),
    ...Object.fromEntries(
      renderRoutes.map((route) => [route, ["node_modules/ffmpeg-static/ffmpeg", "lib/render/fonts/**/*"]]),
    ),
  },
};

export default nextConfig;
