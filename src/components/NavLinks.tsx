"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/collection", label: "Collection" },
  { href: "/friends", label: "Friends" },
  { href: "/trades", label: "Trades" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
] as const;

// Client component so it can read the current route and highlight it — the
// rest of the header stays a server component, this is just the bit that
// needs to know "where am I".
export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-md px-2 py-1 transition-colors ${
              active
                ? "bg-red-600/10 font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300"
                : "text-black/70 hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
