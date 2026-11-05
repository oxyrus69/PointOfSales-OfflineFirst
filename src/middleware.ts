import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { isPublicPath, readSessionToken, rolesForPath, ROLE_HOME } from "@/server/session";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(env.sessionCookieName)?.value;
  const session = await readSessionToken(token);

  if (isPublicPath(pathname)) {
    if (pathname === "/login" && session) {
      return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED", message: "Sesi tidak ditemukan atau kedaluwarsa." },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const allowed = rolesForPath(pathname);
  if (!allowed.includes(session.role)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: `Peran ${session.role} tidak memiliki akses ke ${pathname}.` },
        { status: 403 },
      );
    }
    const home = new URL(ROLE_HOME[session.role], request.url);
    home.searchParams.set("denied", pathname);
    return NextResponse.redirect(home);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js\\.map)$).*)"],
};
