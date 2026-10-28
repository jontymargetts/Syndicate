import FinesManager, { type FineItem } from "@/components/FinesManager";
import { fetchTable, listFines } from "@/lib/records";
import { loadTracker } from "@/lib/tracker";
import { todayDay } from "@/lib/entries";
import { cutoffDate } from "@/lib/stats";

export const metadata = { title: "Fines | Syndicate" };
export const dynamic = "force-dynamic";

export default async function FinesPage() {
  const tracker = loadTracker();
  if (!tracker) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
        <p className="font-medium text-slate-800 dark:text-slate-200">No tracker data imported.</p>
        <p className="mt-2">Run the importer (see the README) and commit the generated files in data/.</p>
      </section>
    );
  }

  const fines = await fetchTable(listFines);
  const cutoff = cutoffDate(tracker);
  const cutoffDay = cutoff ? cutoff.toISOString().slice(0, 10) : "9999-12-31";
  const items: FineItem[] = (fines ?? []).map(({ id, member, amount, reason, date, paidAt }) => ({
    id,
    member,
    amount,
    reason,
    date,
    paidAt,
  }));

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Fines</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Fines given to members, and whether they have been paid. Paid fines add to the pot and unpaid ones are overdue, as
          shown on the Members page.
        </p>
      </section>
      <FinesManager
        members={tracker.members.map((m) => m.name)}
        today={todayDay()}
        cutoffDay={cutoffDay}
        connected={fines !== null}
        fines={items}
      />
    </div>
  );
}
