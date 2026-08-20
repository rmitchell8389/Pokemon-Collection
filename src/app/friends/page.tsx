import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sendFriendRequest, respondToFriendRequest } from "./actions";

export default async function FriendsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: friendships } = await supabase
    .from("friendships")
    .select("id, user_id, friend_user_id, status")
    .or(`user_id.eq.${user.id},friend_user_id.eq.${user.id}`);

  const rows = friendships ?? [];
  const incoming = rows.filter((f) => f.friend_user_id === user.id && f.status === "pending");
  const outgoing = rows.filter((f) => f.user_id === user.id && f.status === "pending");
  const accepted = rows.filter((f) => f.status === "accepted");

  const otherIds = Array.from(
    new Set(rows.map((f) => (f.user_id === user.id ? f.friend_user_id : f.user_id)))
  );
  const { data: profiles } =
    otherIds.length > 0
      ? await supabase.from("profiles").select("id, display_name, email").in("id", otherIds)
      : { data: [] as { id: string; display_name: string; email: string }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold tracking-tight">Friends</h1>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form action={sendFriendRequest} className="panel flex gap-2">
        <input
          name="identifier"
          type="text"
          placeholder="Friend's email or username"
          required
          className="input flex-1"
        />
        <button type="submit" className="btn-primary">
          Add friend
        </button>
      </form>

      {incoming.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            Requests
            <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {incoming.length}
            </span>
          </h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((f) => {
              const other = profileById.get(f.user_id);
              return (
                <li key={f.id} className="panel flex items-center justify-between border-l-4 border-l-amber-400">
                  <span className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-sm font-semibold text-amber-700 dark:text-amber-400">
                      {(other?.display_name ?? other?.email ?? "?").charAt(0).toUpperCase()}
                    </span>
                    {other?.display_name ?? other?.email ?? "Unknown"}
                  </span>
                  <div className="flex gap-2">
                    <form action={respondToFriendRequest}>
                      <input type="hidden" name="friendshipId" value={f.id} />
                      <input type="hidden" name="accept" value="true" />
                      <button className="btn-success btn-sm">Accept</button>
                    </form>
                    <form action={respondToFriendRequest}>
                      <input type="hidden" name="friendshipId" value={f.id} />
                      <input type="hidden" name="accept" value="false" />
                      <button className="btn-secondary btn-sm">Decline</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          Your friends
          {accepted.length > 0 && (
            <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              {accepted.length}
            </span>
          )}
        </h2>
        {accepted.length === 0 ? (
          <p className="panel text-sm text-black/60 dark:text-white/60">
            No friends yet — add one above by email or username.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {accepted.map((f) => {
              const otherId = f.user_id === user.id ? f.friend_user_id : f.user_id;
              const other = profileById.get(otherId);
              return (
                <li key={f.id} className="panel flex items-center justify-between gap-2 border-l-4 border-l-emerald-400">
                  <span className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      {(other?.display_name ?? other?.email ?? "?").charAt(0).toUpperCase()}
                    </span>
                    {other?.display_name ?? other?.email ?? "Unknown"}
                  </span>
                  <Link href={`/collection?friend=${otherId}&lang=en`} className="btn-secondary btn-sm">
                    View collection
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {outgoing.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Pending (sent by you)</h2>
          <ul className="flex flex-col gap-1 text-sm text-black/60 dark:text-white/60">
            {outgoing.map((f) => {
              const other = profileById.get(f.friend_user_id);
              return <li key={f.id}>{other?.display_name ?? other?.email ?? "Unknown"} — waiting</li>;
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
