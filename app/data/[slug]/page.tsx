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
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{sheet.name}</h1>
      <DataTable columns={sheet.columns} rows={sheet.rows} />
    </section>
  );
}
