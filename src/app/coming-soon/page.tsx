import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Deliberately not a hand-maintained page — it's a filtered view of the
// same feature_requests table the /feedback board writes to (status =
// 'planned' or 'in_progress'), set by Ross directly in the Supabase table
// editor. See the comment on that table in supabase/schema.sql.
export default async function ComingSoonPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: requests } = await supabase
    .from("feature_requests")
    .select("id, title, description, status, created_at")
    .in("status", ["planned", "in_progress"])
    .order("status", { ascending: true })
    .order("created_at", { ascending: true });

  const rows = requests ?? [];
  const inProgress = rows.filter((r) => r.status === "in_progress");
  const planned = rows.filter((r) => r.status === "planned");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Coming soon</h1>
        <Link href="/feedback" className="btn-secondary btn-sm">
          Suggest a feature →
        </Link>
      </div>
      <p className="text-sm text-black/60 dark:text-white/60">
        What&rsquo;s actively being worked on and what&rsquo;s next, pulled straight from the
        feature request board.
      </p>

      {rows.length === 0 ? (
        <p className="panel text-sm">
          Nothing marked as planned or in progress right now — check the{" "}
          <Link href="/feedback" className="underline">
            feature request board
          </Link>{" "}
          to see (and add to) what&rsquo;s been suggested.
        </p>
      ) : (
        <>
          {inProgress.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-black/50 dark:text-white/50">
                In progress
              </h2>
              {inProgress.map((r) => (
                <div key={r.id} className="panel border-l-4 border-l-amber-500">
                  <h3 className="font-semibold">{r.title}</h3>
                  {r.description && (
                    <p className="text-sm text-black/70 dark:text-white/70">{r.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {planned.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-black/50 dark:text-white/50">Planned</h2>
              {planned.map((r) => (
                <div key={r.id} className="panel border-l-4 border-l-violet-500">
                  <h3 className="font-semibold">{r.title}</h3>
                  {r.description && (
                    <p className="text-sm text-black/70 dark:text-white/70">{r.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
