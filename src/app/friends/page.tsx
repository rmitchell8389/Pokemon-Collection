import { redirect } from "next/navigation";
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
      <h1 className="text-2xl font-semibold">Friends</h1>

      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form action={sendFriendRequest} className="flex gap-2">
        <input
          name="email"
          type="email"
          placeholder="Friend's email"
          required
          className="flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
        <button type="submit" className="rounded bg-red-600 px-4 py-2 font-medium text-white">
          Add friend
        </button>
      </form>

      {incoming.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Requests</h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((f) => {
              const other = profileById.get(f.user_id);
              return (
                <li key={f.id} className="flex items-center justify-between rounded border border-black/10 p-3 dark:border-white/10">
                  <span>{other?.display_name ?? other?.email ?? "Unknown"}</span>
                  <div className="flex gap-2">
                    <form action={respondToFriendRequest}>
                      <input type="hidden" name="friendshipId" value={f.id} />
                      <input type="hidden" name="accept" value="true" />
                      <button className="rounded bg-green-600 px-3 py-1 text-sm text-white">Accept</button>
                    </form>
                    <form action={respondToFriendRequest}>
                      <input type="hidden" name="friendshipId" value={f.id} />
                      <input type="hidden" name="accept" value="false" />
                      <button className="rounded border border-black/15 px-3 py-1 text-sm dark:border-white/20">
                        Decline
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-medium">Your friends</h2>
        {accepted.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            No friends yet — add one above by email.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {accepted.map((f) => {
              const otherId = f.user_id === user.id ? f.friend_user_id : f.user_id;
              const other = profileById.get(otherId);
              return (
                <li key={f.id} className="rounded border border-black/10 p-3 dark:border-white/10">
                  {other?.display_name ?? other?.email ?? "Unknown"}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {outgoing.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Pending (sent by you)</h2>
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
