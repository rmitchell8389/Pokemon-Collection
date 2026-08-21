import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { importDexCsv, importPulseTcgCsv } from "./actions";

interface ImportSearchParams {
  error?: string;
  source?: string;
  total?: string;
  skipped?: string;
  malformed?: string;
  imported?: string;
  lowConfidenceCount?: string;
  failedCount?: string;
  lowConfExamples?: string;
  lowConfMore?: string;
  failExamples?: string;
  failMore?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  dex: "Dex",
  pulsetcg: "PulseTCG",
};

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<ImportSearchParams>;
}) {
  const params = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const hasSummary = params.total !== undefined;
  const sourceLabel = SOURCE_LABELS[params.source ?? ""] ?? "";
  const importedCount = Number(params.imported ?? 0);
  const lowConfidenceCount = Number(params.lowConfidenceCount ?? 0);
  const failedCount = Number(params.failedCount ?? 0);
  const lowConfExamples = params.lowConfExamples ? params.lowConfExamples.split(" | ") : [];
  const failExamples = params.failExamples ? params.failExamples.split(" | ") : [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import your collection</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Bring your cards and quantities straight in from a service you already track your
          collection in, instead of re-adding everything by hand. Only International/English
          exports are supported right now. Collectr import is coming later.
        </p>
      </div>

      {params.error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {params.error}
        </p>
      )}

      <section className="panel flex flex-col gap-3">
        <h2 className="font-semibold">Import from Dex</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          In Dex: your collection → export → CSV. Re-importing the same file later is safe — a
          card already in your collection just gets its quantity refreshed to match the file, it&apos;s
          never duplicated.
        </p>
        <form action={importDexCsv} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="file"
            name="file"
            accept=".csv"
            required
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-red-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-red-700"
          />
          <button type="submit" className="btn-primary self-start">
            Import
          </button>
        </form>
      </section>

      <section className="panel flex flex-col gap-3">
        <h2 className="font-semibold">Import from PulseTCG</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          In PulseTCG: your portfolio → export → CSV. Same safe re-import behavior as Dex. Sealed
          product rows (not single cards) are skipped and reported, not guessed at. Condition and
          graded-card info aren&apos;t tracked by this app yet, so they won&apos;t carry over.
        </p>
        <form action={importPulseTcgCsv} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="file"
            name="file"
            accept=".csv"
            required
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-red-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-red-700"
          />
          <button type="submit" className="btn-primary self-start">
            Import
          </button>
        </form>
      </section>

      {hasSummary && (
        <section className="panel flex flex-col gap-4">
          <h2 className="font-semibold">Last import result{sourceLabel ? ` — ${sourceLabel}` : ""}</h2>

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/40">
              <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{importedCount}</div>
              <div className="text-black/60 dark:text-white/60">imported</div>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/40">
              <div className="text-xl font-bold text-amber-700 dark:text-amber-300">{lowConfidenceCount}</div>
              <div className="text-black/60 dark:text-white/60">imported, low-confidence variant</div>
            </div>
            <div className="rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
              <div className="text-xl font-bold text-red-700 dark:text-red-300">{failedCount}</div>
              <div className="text-black/60 dark:text-white/60">not imported</div>
            </div>
            <div className="rounded-lg bg-black/5 p-3 dark:bg-white/5">
              <div className="text-xl font-bold">{params.skipped ?? 0}</div>
              <div className="text-black/60 dark:text-white/60">not currently owned (qty 0), skipped</div>
            </div>
          </div>

          {Number(params.malformed ?? 0) > 0 && (
            <p className="text-sm text-red-700 dark:text-red-300">
              {params.malformed} line(s) in the file didn&apos;t match the expected export format and
              were skipped entirely.
            </p>
          )}

          {lowConfidenceCount > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                Imported, but worth double-checking
              </h3>
              <p className="mb-1 text-xs text-black/50 dark:text-white/50">
                The variant label for these didn&apos;t clearly match one of ours, but your card only
                had one alternate print, so it was used. Worth a quick look on your Collection page.
              </p>
              <ul className="list-inside list-disc text-sm">
                {lowConfExamples.map((ex, i) => (
                  <li key={i}>{ex}</li>
                ))}
              </ul>
              {params.lowConfMore && (
                <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                  +{params.lowConfMore} more not shown.
                </p>
              )}
            </div>
          )}

          {failedCount > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">Couldn&apos;t import</h3>
              <ul className="list-inside list-disc text-sm">
                {failExamples.map((ex, i) => (
                  <li key={i}>{ex}</li>
                ))}
              </ul>
              {params.failMore && (
                <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                  +{params.failMore} more not shown.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
