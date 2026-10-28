"use client";

// Members x post-cut-off weeks. Every cell starts as paid (standing orders); a click records a missed payment,
// and a click again re-ticks it. Saves through POST /api/payments, then refreshes the server data.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type PaymentException, WEEKLY_PAYMENT, formatGBP, isPaid } from "@/lib/stats";

export type GridWeek = { week: number; start: string };

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800";

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string };
    if (data.message) return data.message;
  } catch {
    // fall through
  }
  return `Request failed (${res.status}).`;
}

export default function PaymentGrid({
  members,
  weeks,
  exceptions,
  connected,
}: {
  members: string[];
  weeks: GridWeek[];
  exceptions: PaymentException[];
  connected: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState({ member: members[0] ?? "", week: weeks.at(-1)?.week ?? 0, text: "" });

  async function save(member: string, week: number, paid: boolean, text: string) {
    setPending(`${member}|${week}`);
    setError(null);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ member, weekNumber: week, paid, note: text }),
      });
      if (!res.ok) {
        setError(await errorMessage(res));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not save. Check your connection and try again.");
      return false;
    } finally {
      setPending(null);
    }
  }

  function toggle(member: string, week: number) {
    const current = exceptions.find((e) => e.member === member && e.weekNumber === week);
    const paidNow = isPaid(exceptions, member, week);
    save(member, week, !paidNow, current?.note ?? "");
  }

  async function recordMissed(e: React.FormEvent) {
    e.preventDefault();
    const ok = await save(note.member, note.week, false, note.text.trim());
    if (ok) setNote({ ...note, text: "" });
  }

  const totals = members.map((m) => {
    const missed = weeks.filter((w) => !isPaid(exceptions, m, w.week)).length;
    return { member: m, paid: weeks.length - missed, missed };
  });

  if (weeks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
        No week after the cut-off has started yet. Payments are counted from the week after the spreadsheet ends.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th scope="col" className="sticky left-0 z-[1] whitespace-nowrap bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Member
              </th>
              {weeks.map((w) => (
                <th key={w.week} scope="col" className="whitespace-nowrap px-2 py-2 text-center font-medium text-slate-600 dark:text-slate-300">
                  <div>Wk {w.week}</div>
                  <div className="text-xs font-normal text-slate-500 dark:text-slate-400">{w.start}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {members.map((m) => (
              <tr key={m}>
                <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-white px-3 py-2 text-left font-medium text-slate-900 dark:bg-slate-900 dark:text-white">
                  {m}
                </th>
                {weeks.map((w) => {
                  const paid = isPaid(exceptions, m, w.week);
                  const busy = pending === `${m}|${w.week}`;
                  return (
                    <td key={w.week} className="px-1 py-1 text-center">
                      <button
                        type="button"
                        disabled={!connected || busy}
                        aria-pressed={paid}
                        aria-label={`${m}, week ${w.week}: ${paid ? "paid" : "missed"}. Click to mark ${paid ? "missed" : "paid"}.`}
                        onClick={() => toggle(m, w.week)}
                        className={`w-16 rounded px-1 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                          paid
                            ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
                            : "bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:hover:bg-rose-900/60"
                        }`}
                      >
                        {busy ? "Saving" : paid ? "Paid" : "Missed"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              {["Member", "Paid weeks", "Missed weeks", `Paid (${formatGBP(WEEKLY_PAYMENT)} each)`, "Missed (amount)"].map((h) => (
                <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {totals.map((t) => (
              <tr key={t.member}>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900 dark:text-white">{t.member}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{t.paid}</td>
                <td className={`whitespace-nowrap px-3 py-2 tabular-nums ${t.missed ? "font-medium text-rose-700 dark:text-rose-400" : ""}`}>{t.missed}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(t.paid * WEEKLY_PAYMENT)}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(t.missed * WEEKLY_PAYMENT)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={recordMissed} className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-slate-700">
        <p className="text-sm text-slate-600 sm:col-span-2 lg:col-span-5 dark:text-slate-300">
          Record a missed payment with a note (for example, the bank did not send it). Clicking a cell above also works; the note
          is kept when a cell is toggled.
        </p>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Member</span>
          <select className={inputClass} value={note.member} onChange={(e) => setNote({ ...note, member: e.target.value })} disabled={!connected}>
            {members.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Week</span>
          <select className={inputClass} value={note.week} onChange={(e) => setNote({ ...note, week: Number(e.target.value) })} disabled={!connected}>
            {weeks.map((w) => (
              <option key={w.week} value={w.week}>
                Wk {w.week} ({w.start})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm sm:col-span-2 lg:col-span-2">
          <span className="text-slate-600 dark:text-slate-300">Note</span>
          <input className={inputClass} value={note.text} maxLength={500} onChange={(e) => setNote({ ...note, text: e.target.value })} disabled={!connected} placeholder="e.g. standing order bounced" />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={!connected || pending !== null}
            className="w-full rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-60"
          >
            Mark as missed
          </button>
        </div>
      </form>
    </div>
  );
}
