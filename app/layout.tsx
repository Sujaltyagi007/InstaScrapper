import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AppSessionProvider } from "@/components/providers/session-provider";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});


export const metadata: Metadata = {
  title: "IG Monitor",
  description: "Monitor public Instagram accounts for changes and get notified.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${outfit.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AppSessionProvider>
          {children}
          <Toaster position="top-right" />
        </AppSessionProvider>
      </body>
    </html>
  );
}
