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
  // /api/health used to import provider-factory.ts (which pulls in the whole
  // scraping engine) just to read a mode string. It no longer imports it, so
  // it doesn't need the native TLS binary and isn't listed here anymore.
  "/api/media/\\[id\\]/redownload",
  "/api/media/\\[id\\]/full",
  "/api/media/\\[id\\]/repost",
  "/api/cron/cleanup",
  "/api/niche",
  "/api/niche/accounts",
  "/api/niche/suggestions",
];

// Routes that burn captions. They need the font shipped with the function, which
// no import reaches. The ffmpeg binary is NOT listed: the tracer already ships it
// via its real .pnpm path, and "node_modules/ffmpeg-static/ffmpeg" goes through
// pnpm's symlink, which Vercel rejects ("files in symlinked directories").
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

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Browsers only honour HSTS over HTTPS (Vercel), so plain-http local runs aren't affected.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // The service worker must never be cached, or users keep an old one after a deploy.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  serverExternalPackages:["got-scraping", "header-generator", "@dryft/tlsclient", "ffi-rs", "workerpool", "ffmpeg-static"],
  outputFileTracingIncludes: {
    ...Object.fromEntries(stealthRoutes.map((route) => [route, ["lib/native/**/*"]])),
    ...Object.fromEntries(
      renderRoutes.map((route) => [route, ["lib/render/fonts/**/*"]]),
    ),
  },
};

export default nextConfig;
