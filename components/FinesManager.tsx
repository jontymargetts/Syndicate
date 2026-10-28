"use client";

// Fines: add, mark paid or unpaid, delete. Saves through POST /api/fines, PATCH /api/fines/:id, DELETE /api/fines/:id.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDate, formatGBP } from "@/lib/stats";
import { dayToDate } from "@/lib/entries";

export type FineItem = {
  id: string;
  member: string;
  amount: number;
  reason: string;
  /** YYYY-MM-DD */
  date: string;
  paidAt: string | null;
};

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

export default function FinesManager({
  members,
  today,
  cutoffDay,
  connected,
  fines,
}: {
  members: string[];
  today: string;
  /** YYYY-MM-DD: unpaid fines dated on or after this count as overdue in the figures. */
  cutoffDay: string;
  connected: boolean;
  fines: FineItem[];
}) {
  const router = useRouter();
  const emptyForm = { member: members[0] ?? "", amount: "", reason: "", date: today };
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const unpaid = fines.filter((f) => !f.paidAt);
  const unpaidTotal = unpaid.reduce((s, f) => s + f.amount, 0);
  const unpaidByMember = (() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const f of unpaid) {
      const entry = map.get(f.member) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += f.amount;
      map.set(f.member, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  })();

  async function addFine(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    setBusy("add");
    try {
      const res = await fetch("/api/fines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setFormError(await errorMessage(res));
        return;
      }
      setForm({ ...emptyForm, member: form.member, date: form.date });
      setNotice("Fine added.");
      router.refresh();
    } catch {
      setFormError("Could not save the fine. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function setPaid(f: FineItem, paid: boolean) {
    setNotice(null);
    setBusy(f.id);
    try {
      const res = await fetch(`/api/fines/${f.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paid }),
      });
      if (!res.ok) {
        setNotice(await errorMessage(res));
        return;
      }
      router.refresh();
    } catch {
      setNotice("Could not update the fine. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(f: FineItem) {
    if (!window.confirm(`Delete the ${formatGBP(f.amount)} fine for ${f.member} (${f.reason || "no reason"})? This cannot be undone.`)) return;
    setNotice(null);
    setBusy(f.id);
    try {
      const res = await fetch(`/api/fines/${f.id}`, { method: "DELETE" });
      if (!res.ok) {
        setNotice(await errorMessage(res));
        return;
      }
      router.refresh();
    } catch {
      setNotice("Could not delete the fine. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const disabled = !connected;

  return (
    <div className="space-y-8">
      {!connected && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Database not connected: fines cannot be recorded, and the figures show the spreadsheet only.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Unpaid fines recorded here</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{formatGBP(unpaidTotal)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {unpaid.length} unpaid. Those given on or after {formatDate(dayToDate(cutoffDay))} count as overdue in the figures.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Unpaid by member</p>
          {unpaidByMember.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No unpaid fines.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {unpaidByMember.map(([name, v]) => (
                <li key={name} className="flex justify-between gap-3">
                  <span className="text-slate-700 dark:text-slate-200">{name}</span>
                  <span className="tabular-nums text-slate-600 dark:text-slate-300">
                    {formatGBP(v.total)} ({v.count})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white">Add a fine</h2>
        <form onSubmit={addFine} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Member *</span>
            <select className={inputClass} value={form.member} onChange={(e) => setForm({ ...form, member: e.target.value })} disabled={disabled}>
              {members.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Amount (GBP) *</span>
            <input className={inputClass} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} disabled={disabled} placeholder="5.00" />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-slate-600 dark:text-slate-300">Reason</span>
            <input className={inputClass} value={form.reason} maxLength={200} onChange={(e) => setForm({ ...form, reason: e.target.value })} disabled={disabled} placeholder="e.g. late payment" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Date *</span>
            <input className={inputClass} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} disabled={disabled} />
          </label>
          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-5">
            <button type="submit" disabled={disabled || busy !== null} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
              Add fine
            </button>
            {formError && (
              <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                {formError}
              </p>
            )}
          </div>
        </form>
      </section>

      {notice && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
          {notice}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white">Fines</h2>
        {fines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
            No fines recorded here yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  {["Date", "Member", "Reason", "Amount", "Status", "Counted", ""].map((h, i) => (
                    <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {fines.map((f) => {
                  const isBusy = busy === f.id;
                  const counted = f.paidAt
                    ? f.paidAt.slice(0, 10) >= cutoffDay
                      ? "Counted: paid"
                      : "No: paid before cut-off"
                    : f.date >= cutoffDay
                      ? "Counted: overdue"
                      : "No: before cut-off";
                  return (
                    <tr key={f.id}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(dayToDate(f.date))}</td>
                      <td className="whitespace-nowrap px-3 py-2">{f.member}</td>
                      <td className="px-3 py-2">{f.reason || "-"}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(f.amount)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {f.paidAt ? (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">Paid {formatDate(new Date(f.paidAt))}</span>
                        ) : (
                          <span className="font-medium text-rose-700 dark:text-rose-400">Unpaid</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{counted}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <div className="flex justify-end gap-3">
                          {f.paidAt ? (
                            <button type="button" disabled={disabled || isBusy} onClick={() => setPaid(f, false)} className="hover:underline disabled:opacity-60">
                              Mark unpaid
                            </button>
                          ) : (
                            <button type="button" disabled={disabled || isBusy} onClick={() => setPaid(f, true)} className="rounded-md bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-500 disabled:opacity-60">
                              Mark as paid
                            </button>
                          )}
                          <button type="button" disabled={disabled || isBusy} onClick={() => remove(f)} className="text-rose-600 hover:underline disabled:opacity-60 dark:text-rose-400">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-slate-600 dark:text-slate-300">
          A fine marked paid after the cut-off adds to fines paid and the pot. An unpaid fine given after the cut-off is overdue.
          Fines from before the cut-off are already in the spreadsheet and are not counted here.
        </p>
      </section>
    </div>
  );
}
