import ResultsManager, { type ResultItem } from "@/components/ResultsManager";
import { fetchTable, listResults } from "@/lib/records";
import { loadTracker } from "@/lib/tracker";
import { resultMembers, todayDay } from "@/lib/entries";
import { cutoffDate } from "@/lib/stats";

export const metadata = { title: "Results | Syndicate" };
export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const tracker = loadTracker();
  if (!tracker) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
        <p className="font-medium text-slate-800 dark:text-slate-200">No tracker data imported.</p>
        <p className="mt-2">Run the importer (see the README) and commit the generated files in data/.</p>
      </section>
    );
  }

  const results = await fetchTable(listResults);
  const cutoff = cutoffDate(tracker);
  const cutoffDay = cutoff ? cutoff.toISOString().slice(0, 10) : "9999-12-31";
  const items: ResultItem[] = (results ?? []).map(({ id, date, member, description, stake, returns, notes }) => ({
    id,
    date,
    member,
    description,
    stake,
    returns,
    notes,
  }));

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Results</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Record the result of a bet that was not placed through the Bet Queue. Each result counts as the bets in the queue
          do: its returns go to punts, and it is credited to the member it was entered for.
        </p>
      </section>
      <ResultsManager
        members={resultMembers(tracker.members.map((m) => m.name))}
        today={todayDay()}
        cutoffDay={cutoffDay}
        connected={results !== null}
        results={items}
      />
    </div>
  );
}
