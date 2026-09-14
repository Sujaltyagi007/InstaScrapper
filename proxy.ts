import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register"];

export default withAuth(
  function middleware(req: any) {
    return NextResponse.next();
  }, {
  callbacks: {
    authorized: ({ req, token }: { req: any; token: any }) => {
      const { pathname } = req.nextUrl;
      const isPublic =
        PUBLIC_PATHS.includes(pathname) ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/cron") ||
        pathname.startsWith("/api/health") ||
        pathname.startsWith("/api/ready");

      if (isPublic) return true;
      return !!token;
    },
  },
  pages: {
    signIn: "/login",
  },
}
);

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
