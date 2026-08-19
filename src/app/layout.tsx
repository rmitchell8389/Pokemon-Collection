import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./auth/actions";

// Deliberately not using next/font/google here — it requires a build-time
// fetch to fonts.googleapis.com, which is one less external dependency to
// worry about for a small hobby project. System font stack via Tailwind's
// default `font-sans` is fine.

export const metadata: Metadata = {
  title: "Pokemon Collection Tracker",
  description:
    "Track your Pokemon card collection across English, Japanese, Traditional Chinese and Simplified Chinese, and find trades with friends.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PokeCollection",
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 dark:border-white/10">
          <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 text-sm">
            <Link href="/" className="font-semibold">
              PokeCollection
            </Link>
            {user ? (
              <div className="flex items-center gap-4">
                <Link href="/collection">Collection</Link>
                <Link href="/friends">Friends</Link>
                <Link href="/trades">Trades</Link>
                <form action={signOut}>
                  <button type="submit" className="text-black/60 dark:text-white/60">
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <Link href="/login">Sign in</Link>
                <Link href="/signup">Sign up</Link>
              </div>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
