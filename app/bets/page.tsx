import BetQueue from "@/components/BetQueue";

export const metadata = { title: "Bet Queue | Syndicate" };

export default function BetsPage() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Bet Queue</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Members propose bets, the leader approves them, places them manually on bet365, then records the result.
          Nothing is placed automatically.
        </p>
      </div>
      <BetQueue />
    </section>
  );
}
