import { NextRequest, NextResponse } from "next/server";
import { defaultLocale, isLocale } from "./lib/i18n";
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/" || path === "/tools" || path.startsWith("/tools/")) {
    const target = request.nextUrl.clone();
    target.pathname = `/${defaultLocale}${path === "/" ? "" : path}`;
    return NextResponse.redirect(target, 308);
  }
  const segment = path.split("/")[1];
  const headers = new Headers(request.headers);
  headers.set("x-yoyo-locale", isLocale(segment) ? segment : defaultLocale);
  return NextResponse.next({ request: { headers } });
}
export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
