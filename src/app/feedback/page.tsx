import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { submitFeatureRequest } from "./actions";

type Status = "open" | "planned" | "in_progress" | "done" | "declined";

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  declined: "Declined",
};

const STATUS_STYLES: Record<Status, string> = {
  open: "bg-black/10 text-black/70 dark:bg-white/10 dark:text-white/70",
  planned: "bg-violet-600 text-white",
  in_progress: "bg-amber-500 text-white",
  done: "bg-emerald-600 text-white",
  declined: "bg-black/20 text-black/50 line-through dark:bg-white/10 dark:text-white/40",
};

export default async function FeedbackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: requests } = await supabase
    .from("feature_requests")
    .select("id, user_id, title, description, status, created_at")
    .order("created_at", { ascending: false });

  const rows = requests ?? [];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", userIds)
      : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Feature requests</h1>
        <Link href="/coming-soon" className="btn-secondary btn-sm">
          See what&rsquo;s planned →
        </Link>
      </div>
      <p className="text-sm text-black/60 dark:text-white/60">
        Got an idea for DexMate? Post it below — Ross gets notified and reviews every request.
      </p>

      <form action={submitFeatureRequest} className="panel flex flex-col gap-3">
        <input
          name="title"
          required
          maxLength={200}
          placeholder="Short summary, e.g. Dark mode toggle"
          className="input"
        />
        <textarea
          name="description"
          rows={3}
          maxLength={2000}
          placeholder="Any extra detail (optional)"
          className="input"
        />
        <button type="submit" className="btn-primary self-start">
          Submit request
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="panel text-sm">No feature requests yet — be the first to suggest one.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const status = (r.status ?? "open") as Status;
            return (
              <div key={r.id} className="panel flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{r.title}</h2>
                  <span className={`badge shrink-0 ${STATUS_STYLES[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>
                {r.description && (
                  <p className="text-sm text-black/70 dark:text-white/70">{r.description}</p>
                )}
                <p className="text-xs text-black/40 dark:text-white/40">
                  {nameById.get(r.user_id) ?? "Someone"} ·{" "}
                  {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
