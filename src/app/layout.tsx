import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./auth/actions";
import { PokeballMark } from "@/components/PokeballMark";
import { NavLinks } from "@/components/NavLinks";

// Deliberately not using next/font/google here — it requires a build-time
// fetch to fonts.googleapis.com, which is one less external dependency to
// worry about for a small hobby project. System font stack via Tailwind's
// default `font-sans` is fine.

export const metadata: Metadata = {
  title: "DexMate",
  description:
    "Track your Pokemon card collection across English, Japanese, Traditional Chinese and Simplified Chinese, and find trades with friends.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DexMate",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#dc2626",
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2 py-1 text-black/70 transition-colors hover:bg-black/5 hover:text-black
        dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
    </Link>
  );
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-10 border-b border-black/10 bg-[var(--background)]/85 backdrop-blur-md dark:border-white/10">
          <div className="h-[3px] bg-gradient-to-r from-red-600 via-amber-400 to-red-600" />
          <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 text-sm">
            <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
              <PokeballMark className="h-6 w-6" />
              <span>DexMate</span>
            </Link>
            {user ? (
              <div className="flex items-center gap-1">
                <NavLinks />
                <form action={signOut} className="ml-2">
                  <button
                    type="submit"
                    className="rounded-md px-2 py-1 text-black/50 transition-colors hover:bg-black/5 hover:text-black/80 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/80"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <NavLink href="/login">Sign in</NavLink>
                <Link href="/signup" className="btn-primary btn-sm">
                  Sign up
                </Link>
              </div>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-black/10 py-4 dark:border-white/10">
          <div className="mx-auto flex max-w-4xl justify-center px-4">
            <a
              href="https://ko-fi.com/scottishgruff"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-2 py-1 text-sm text-black/50 transition-colors hover:bg-black/5 hover:text-black/80
                dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/80"
            >
              ☕ Support DexMate on Ko-fi
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
