import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 split what used to be middleware.ts into two file conventions:
// middleware.ts is now edge-only (the `runtime` export doesn't change that,
// which is why setting it there didn't fix Vercel's Edge Function error).
// proxy.ts is the Node.js-runtime equivalent, hardcoded to nodejs, no config
// needed. This is that file — renamed from middleware.ts, function renamed
// from `middleware` to `proxy` (both required by the convention). Needed
// because Supabase's client library pulls in a Node-only dependency (its
// websocket support for realtime features this app doesn't use) that Edge's
// runtime doesn't have.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
