// Reads the single-row `app_settings` table (see supabase/schema.sql) —
// feature toggles Ross flips directly in the Supabase table editor, same
// no-admin-UI pattern as feature_requests.status. Added 2026-08-26 as a
// pause switch for the card pricing feature: flip pricing_enabled to false
// and both /search and /collection stop showing price badges/collection
// value, and the next sync run skips pricing (and the Frankfurter FX call)
// entirely — no code change, no redeploy, no data loss. Flip it back to
// true and everything resumes immediately, using whatever prices are
// already stored (pausing never clears price_usd/price_eur/price_gbp).
//
// Defaults to true (pricing ON) if the row is missing or the query fails,
// rather than false — a schema that hasn't been re-run yet, or a transient
// read error, should leave existing behavior unchanged, not silently hide
// a feature that was working. The only way to actually turn pricing off is
// an explicit `pricing_enabled = false` row update.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function isPricingEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("pricing_enabled")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) return true;
  return data.pricing_enabled !== false;
}
