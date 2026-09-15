import type { NextConfig } from "next";

// Routes that (transitively) import lib/meta/stealth-engine-bridge.ts. The bundled
// native tls-client binaries are loaded via a runtime-computed path (see
// resolveTlsLibPath in that file), which Next's build-time file tracer can't follow
// statically — so each route that needs it must be listed here explicitly, or the
// deployed function won't have the .so file on disk at request time.
const stealthRoutes = [
  "/api/cron/monitor",
  "/api/targets",
  "/api/targets/bulk",
  "/api/targets/resolve",
  "/api/targets/\\[id\\]",
  "/api/sessions",
  "/api/sessions/test",
  "/api/meta/status",
  "/api/health",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["got-scraping", "header-generator", "@dryft/tlsclient", "ffi-rs"],
  outputFileTracingIncludes: Object.fromEntries(
    stealthRoutes.map((route) => [route, ["lib/native/**/*"]])
  ),
  /* config options here */
};

export default nextConfig;
