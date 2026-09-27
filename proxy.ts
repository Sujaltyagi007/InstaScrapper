import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register"];

export default withAuth(
  function middleware() {
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
        pathname.startsWith("/api/ready");

      if (isPublic) return true;
      return !!token;
    },
  },
  pages: { signIn: "/login" }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
