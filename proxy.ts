import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { SCREEN_COOKIE, isScreenPath } from "@/lib/spa/screens";

const PUBLIC_PATHS = ["/login", "/register"];

export default withAuth(
  function middleware(req) {
    const { pathname, search, hash } = req.nextUrl;
    // The app is one page at "/". Old page links (bookmarks, push notifications, the
    // phone's "open reel" link, OAuth returns) are handed to it through a cookie, so
    // the address bar stays "/" and the app opens the right screen.
    if (isScreenPath(pathname)) {
      const res = NextResponse.redirect(new URL("/", req.url));
      res.cookies.set(SCREEN_COOKIE, `${pathname}${search}${hash}`, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
      });
      return res;
    }
    return NextResponse.next();
  }, {
  callbacks: {
    authorized: ({ req, token }) => {
      const { pathname } = req.nextUrl;
      const isPublic =
        PUBLIC_PATHS.includes(pathname) ||
        // PWA files are fetched without a session (install check, service worker update).
        pathname === "/sw.js" ||
        pathname === "/offline.html" ||
        pathname === "/manifest.webmanifest" ||
        pathname.startsWith("/icons/") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/cron") ||
        pathname.startsWith("/api/dev") ||
        pathname.startsWith("/api/health") ||
        pathname.startsWith("/api/ready") ||
        // The home worker script authenticates with its own paired-device
        // bearer token (lib/meta/home-worker.ts::authenticateDevice), not a
        // NextAuth session cookie — it's a separate machine, not a browser tab.
        pathname.startsWith("/api/worker/");

      if (isPublic) return true;
      return !!token;
    },
  },
  pages: { signIn: "/login" }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
