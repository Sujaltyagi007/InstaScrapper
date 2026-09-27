import type { MetadataRoute } from "next";

/** Web app manifest (served at /manifest.webmanifest): makes the app installable. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "IG Monitor",
    short_name: "IG Monitor",
    description: "Monitor Instagram accounts, spot trends, and get notified the moment something changes.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["productivity", "social", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Targets",
        short_name: "Targets",
        url: "/targets",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Add a target",
        short_name: "Add",
        url: "/targets/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Studio",
        short_name: "Studio",
        url: "/studio",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
