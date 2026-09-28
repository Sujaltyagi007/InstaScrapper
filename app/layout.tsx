import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ACCENT_STYLE_TAG_ID, ACCENT_STORAGE_KEY } from "@/lib/theme/accent";
import { AppSessionProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SWRProvider } from "@/components/providers/swr-provider";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});


export const metadata: Metadata = {
  title: "IG Monitor",
  description: "Monitor public Instagram accounts for changes and get notified.",
  applicationName: "IG Monitor",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // iOS home-screen app: full-screen, own title (iOS doesn't read the manifest's name for this).
  appleWebApp: { capable: true, title: "IG Monitor", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

// The accent color is per-user (DB-backed, see /api/settings), not per-request
// data — reading it here with auth()+prisma would make Next treat the ENTIRE
// app as dynamic (this layout wraps every route, including /login and every
// other page that's otherwise statically prerendered). Per Next's own
// guidance for exactly this situation ("Preventing flash before hydration" →
// "Themes"), the fix is an inline script that reads a client-side mirror
// (localStorage, kept in sync by lib/theme/apply-accent-client.ts) and builds
// the <style> tag before first paint. No server data, so every page stays
// static; a brand-new browser just sees the default theme until the first
// /api/settings fetch reconciles it (same one-time cost next-themes already
// accepts for the light/dark toggle).
const ACCENT_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)});if(c){var s=document.createElement("style");s.id=${JSON.stringify(ACCENT_STYLE_TAG_ID)};s.textContent=c;document.head.appendChild(s);}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${outfit.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ACCENT_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          <AppSessionProvider>
            <SWRProvider>
              <PwaProvider>
                {children}
                <Toaster position="top-right" />
              </PwaProvider>
            </SWRProvider>
          </AppSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
