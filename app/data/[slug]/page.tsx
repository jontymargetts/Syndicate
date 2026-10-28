import { notFound } from "next/navigation";
import DataTable from "@/components/DataTable";
import { getIndex, getSheet } from "@/lib/data";

export function generateStaticParams() {
  return getIndex().sheets.map((s) => ({ slug: s.slug }));
}

export default async function DataPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sheet = getSheet(slug);
  if (!sheet) notFound();

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{sheet.name}</h1>
      {sheet.tables.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">This sheet has no data.</p>
      )}
      {sheet.tables.map((t, i) => (
        <div key={`${t.range}-${i}`} className="space-y-3">
          <div>
            <h2 className="text-lg font-medium text-slate-900 dark:text-white">{t.title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Cells {t.range}</p>
          </div>
          <DataTable columns={t.columns} rows={t.rows} />
        </div>
      ))}
    </section>
  );
}
