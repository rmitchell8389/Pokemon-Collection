import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.tcgdex.net",
      },
      {
        // Fallback image source for cards TCGdex has no image for at all —
        // see scripts/backfill-images.ts.
        protocol: "https",
        hostname: "images.pokemontcg.io",
      },
      {
        // Second fallback image source, for cards neither TCGdex nor
        // pokemontcg.io has — see scripts/backfill-images-from-archive.ts.
        // Supabase Storage public URLs are always <project-ref>.supabase.co,
        // wildcarded here since the project ref isn't known at build time.
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
