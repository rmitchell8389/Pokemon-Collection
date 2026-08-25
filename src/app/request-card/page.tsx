import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { submitCardRequest } from "./actions";

type Status = "pending" | "approved" | "rejected";

const STATUS_LABELS: Record<Status, string> = {
  pending: "Pending review",
  approved: "Added to catalog",
  rejected: "Not added",
};

const STATUS_STYLES: Record<Status, string> = {
  pending: "bg-black/10 text-black/70 dark:bg-white/10 dark:text-white/70",
  approved: "bg-emerald-600 text-white",
  rejected: "bg-black/20 text-black/50 line-through dark:bg-white/10 dark:text-white/40",
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  "zh-tw": "Chinese (Traditional)",
  "zh-cn": "Chinese (Simplified)",
};

// Public feed of every submission (not just the signed-in user's own),
// same call as /feedback — lets anyone see a card's already been
// requested before submitting a duplicate, and lets everyone watch it get
// approved without needing their own status page.
export default async function RequestCardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: requests } = await supabase
    .from("card_requests")
    .select("id, user_id, set_name, card_number, name, variant, language, image_url, notes, status, created_at")
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
      <h1 className="text-2xl font-bold tracking-tight">Request a card</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Can&rsquo;t find a card when you search or import? Tell us what it is — Ross reviews every
        request, and once it&rsquo;s approved it&rsquo;s added straight to the shared catalog for
        everyone.
      </p>

      <form action={submitCardRequest} className="panel flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="setName" required maxLength={200} placeholder="Set name (required)" className="input" />
          <input name="cardNumber" maxLength={50} placeholder="Card number" className="input" />
        </div>
        <input name="name" required maxLength={200} placeholder="Card name (required)" className="input" />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            name="variant"
            maxLength={100}
            placeholder="Variant, e.g. Holo (optional)"
            className="input"
          />
          <select name="language" defaultValue="en" className="input">
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="zh-tw">Chinese (Traditional)</option>
            <option value="zh-cn">Chinese (Simplified)</option>
          </select>
        </div>
        <input
          name="imageUrl"
          type="url"
          maxLength={500}
          placeholder="Link to a photo or scan (optional)"
          className="input"
        />
        <textarea
          name="notes"
          rows={2}
          maxLength={1000}
          placeholder="Anything else that helps identify it (optional)"
          className="input"
        />
        <button type="submit" className="btn-primary self-start">
          Submit request
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="panel text-sm">No card requests yet — be the first to suggest one.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const status = (r.status ?? "pending") as Status;
            return (
              <div key={r.id} className="panel flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">
                    {r.name}
                    {r.card_number ? ` · #${r.card_number}` : ""}
                  </h2>
                  <span className={`badge shrink-0 ${STATUS_STYLES[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>
                <p className="text-sm text-black/70 dark:text-white/70">
                  {r.set_name}
                  {r.variant ? ` · ${r.variant}` : ""} · {LANGUAGE_LABELS[r.language] ?? r.language}
                </p>
                {r.image_url && (
                  <a
                    href={r.image_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm text-red-600 hover:underline dark:text-red-400"
                  >
                    View submitted photo →
                  </a>
                )}
                {r.notes && <p className="text-sm text-black/70 dark:text-white/70">{r.notes}</p>}
                <p className="text-xs text-black/40 dark:text-white/40">
                  {nameById.get(r.user_id) ?? "Someone"} · {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
