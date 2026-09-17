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
  "/api/meta/status",
  "/api/health",
  "/api/media/\\[id\\]/redownload",
  "/api/cron/cleanup",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["got-scraping", "header-generator", "@dryft/tlsclient", "ffi-rs"],
  outputFileTracingIncludes: Object.fromEntries(
    stealthRoutes.map((route) => [route, ["lib/native/**/*"]])
  ),
};

export default nextConfig;
