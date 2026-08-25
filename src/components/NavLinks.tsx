"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/collection", label: "Collection" },
  { href: "/search", label: "Search" },
  { href: "/friends", label: "Friends" },
  { href: "/trades", label: "Trades" },
  { href: "/import", label: "Import" },
  { href: "/feedback", label: "Feedback" },
  { href: "/settings", label: "Settings" },
] as const;

// Client component so it can read the current route and highlight it — the
// rest of the header stays a server component, this is just the bit that
// needs to know "where am I".
//
// Real bug reported on Android (see /feedback): with 7 links rendered
// inline, the nav row is wider than a phone screen, and since nothing
// about the row itself scrolls independently, the whole PAGE became
// horizontally scrollable to reveal the rest of it. Fixed by collapsing to
// a hamburger button below the `md` breakpoint instead of trying to make
// an ever-growing link list fit — the plain inline row (unchanged) is kept
// for md+ screens, where it fits comfortably.
//
// `signOut` is passed in as a prop (a server action can be handed to a
// client component this way) purely so the mobile dropdown can include a
// working "Sign out" entry alongside the links, rather than someone having
// to close the menu first to find the separate sign-out button that only
// shows at md+ (see layout.tsx).
export function NavLinks({ signOut }: { signOut: (formData: FormData) => void | Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      <div className="hidden items-center gap-1 md:flex">
        {LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`rounded-md px-2 py-1 transition-colors ${
              isActive(href)
                ? "bg-red-600/10 font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300"
                : "text-black/70 hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="relative md:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center rounded-md text-lg text-black/70 transition-colors hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
        >
          {open ? "✕" : "☰"}
        </button>
        {open && (
          <>
            {/* Full-screen tap-to-close backdrop, behind the panel */}
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-lg border border-black/10 bg-[var(--background)] p-1.5 shadow-lg dark:border-white/10">
              {LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive(href)
                      ? "bg-red-600/10 font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300"
                      : "text-black/70 hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                  }`}
                >
                  {label}
                </Link>
              ))}
              <div className="my-1 border-t border-black/10 dark:border-white/10" />
              <form action={signOut}>
                <button
                  type="submit"
                  className="block w-full rounded-md px-3 py-2 text-left text-sm text-black/50 transition-colors hover:bg-black/5 hover:text-black/80 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/80"
                >
                  Sign out
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </>
  );
}
