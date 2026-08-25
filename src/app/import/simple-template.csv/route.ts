import { SIMPLE_TEMPLATE_CSV } from "@/lib/simpleImport";

// Serves the blank CSV template for /import's "fill in yourself" option as
// a real file download rather than a data: URL — more reliable on mobile
// browsers, and doesn't hit any URL length limit. See src/lib/simpleImport.ts
// for the format itself and why it's a new, simpler shape rather than
// Dex's own export format.
export async function GET() {
  return new Response(SIMPLE_TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="dexmate-collection-template.csv"',
    },
  });
}
