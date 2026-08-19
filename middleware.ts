import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Vercel's post-build check flags this middleware for pulling in a
// Node-only dependency (Supabase's client library, via its websocket
// support for realtime features this app doesn't even use). The default
// Edge runtime doesn't have Node's crypto/http/stream APIs; the Node.js
// runtime does. Running middleware on the Node.js runtime is a supported
// Next.js feature, not a workaround.
export const runtime = "nodejs";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
