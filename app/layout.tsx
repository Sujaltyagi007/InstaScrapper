import "./globals.css";
import { Outfit } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { SWRProvider } from "@/components/providers/swr-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AppSessionProvider } from "@/components/providers/session-provider";
import { ACCENT_STYLE_TAG_ID, ACCENT_STORAGE_KEY } from "@/lib/theme/accent";

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
