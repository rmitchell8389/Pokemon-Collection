"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client — used from Client Components.
// Relies on the anon key, which is safe to expose; row-level security
// policies in supabase/schema.sql are what actually restrict access.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
