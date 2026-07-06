import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  // Intercept POST /auth for token validation (mock: always succeed)
  if (request.nextUrl.pathname === "/auth" && request.method === "POST") {
    return NextResponse.json({ success: true, data: { token: "mock" } })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/auth"],
}
