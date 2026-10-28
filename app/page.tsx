import Link from "next/link";
import { getIndex } from "@/lib/data";

export default function DashboardPage() {
  const index = getIndex();
  const hasData = index.sheets.length > 0;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Dashboard</h1>
        {index.importedAt && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Data from {index.source} imported {new Date(index.importedAt).toLocaleString("en-GB")}
          </p>
        )}
      </section>

      {!hasData && (
        <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          <p className="font-medium text-slate-800 dark:text-slate-200">No spreadsheet data imported yet.</p>
          <p className="mt-2">
            Run <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">python3 scripts/import-xlsx.py path/to/file.xlsx</code>{" "}
            and commit the generated files in <code>data/</code>. See the README for details.
          </p>
        </section>
      )}

      {hasData && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-slate-900 dark:text-white">Sheets</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {index.sheets.map((s) => (
              <Link
                key={s.slug}
                href={`/data/${s.slug}`}
                className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
              >
                <p className="font-medium text-slate-900 dark:text-white">{s.name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {s.rowCount} rows, {s.columnCount} columns
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <Link href="/bets" className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
          Open the Bet Queue
        </Link>
      </section>
    </div>
  );
}
