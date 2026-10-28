"use client";

// Results entered by hand: a single-result form, and a CSV upload with a preview. Nothing is saved from the
// CSV until every row passes the checks. Saves through POST /api/results and DELETE /api/results/:id.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DEFAULT_RESULT_STAKE,
  type CsvRowCheck,
  type ResultInput,
  checkResultsCsv,
  dayToDate,
} from "@/lib/entries";
import { formatGBP, formatDate, resultOutcome } from "@/lib/stats";

export type ResultItem = {
  id: string;
  date: string;
  member: string;
  description: string;
  stake: number;
  returns: number;
  notes: string;
};

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800";
const buttonClass =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200";

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string };
    if (data.message) return data.message;
  } catch {
    // fall through
  }
  return `Request failed (${res.status}).`;
}

const OUTCOME_LABEL = { settled_won: "Won", settled_lost: "Lost", settled_void: "Void" } as const;

export default function ResultsManager({
  members,
  today,
  cutoffDay,
  connected,
  results,
}: {
  members: string[];
  today: string;
  /** YYYY-MM-DD: results dated before this are not counted. */
  cutoffDay: string;
  connected: boolean;
  results: ResultItem[];
}) {
  const router = useRouter();
  const emptyForm = { date: today, member: members[0] ?? "", description: "", stake: DEFAULT_RESULT_STAKE.toFixed(2), returns: "", notes: "" };
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [csv, setCsv] = useState<{ fileName: string; headerError: string | null; rows: CsvRowCheck[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const csvErrors = csv ? csv.rows.filter((r) => r.error).length : 0;
  const csvReady = csv !== null && csv.headerError === null && csv.rows.length > 0 && csvErrors === 0;

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setFormError(await errorMessage(res));
        return;
      }
      setForm({ ...emptyForm, date: form.date, member: form.member });
      setNotice("Result saved.");
      router.refresh();
    } catch {
      setFormError("Could not save the result. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function onFile(file: File | undefined) {
    setNotice(null);
    if (!file) {
      setCsv(null);
      return;
    }
    const text = await file.text();
    const checked = checkResultsCsv(text, { members, today });
    setCsv({ fileName: file.name, headerError: checked.headerError, rows: checked.rows });
  }

  async function importCsv() {
    if (!csv || !csvReady) return;
    const rows: ResultInput[] = csv.rows.map((r) => r.value as ResultInput);
    setSaving(true);
    try {
      const res = await fetch("/api/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        setNotice(await errorMessage(res));
        return;
      }
      setCsv(null);
      setNotice(`${rows.length} result${rows.length === 1 ? "" : "s"} imported.`);
      router.refresh();
    } catch {
      setNotice("Could not import the file. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: ResultItem) {
    if (!window.confirm(`Delete the result for ${r.member} on ${r.date} (${formatGBP(r.returns)} returned)? This cannot be undone.`)) return;
    setNotice(null);
    try {
      const res = await fetch(`/api/results/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        setNotice(await errorMessage(res));
        return;
      }
      router.refresh();
    } catch {
      setNotice("Could not delete the result. Check your connection and try again.");
    }
  }

  const disabled = !connected;

  return (
    <div className="space-y-8">
      {!connected && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Database not connected: results cannot be saved, and the figures show the spreadsheet only.
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
          {notice}
        </p>
      )}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white">Add a result</h2>
        <form onSubmit={submitForm} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Date *</span>
            <input className={inputClass} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} disabled={disabled} />
          </label>
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
            <span className="text-slate-600 dark:text-slate-300">Description</span>
            <input className={inputClass} value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={disabled} placeholder="e.g. Arsenal to win" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Stake (GBP)</span>
            <input className={inputClass} inputMode="decimal" value={form.stake} onChange={(e) => setForm({ ...form, stake: e.target.value })} disabled={disabled} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Returns (GBP, incl. stake; 0 for a loss) *</span>
            <input className={inputClass} inputMode="decimal" value={form.returns} onChange={(e) => setForm({ ...form, returns: e.target.value })} disabled={disabled} placeholder="0" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Notes</span>
            <input className={inputClass} value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={disabled} />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <button type="submit" disabled={disabled || saving} className={buttonClass}>
              Save result
            </button>
            {formError && (
              <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                {formError}
              </p>
            )}
          </div>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white">Upload a CSV</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Columns, in this order: <code>date,member,description,stake,returns</code>. Dates are YYYY-MM-DD. Member is one of the
          names on the sheet, or <code>Syndicate</code>. A blank stake means 2.50. Returns include the stake (0 for a loss).{" "}
          <a href="/results-template.csv" download className="underline underline-offset-2">
            Download the template
          </a>
          .
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={disabled || saving}
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 dark:text-slate-200 dark:file:bg-slate-700"
        />

        {csv && (
          <div className="space-y-3">
            {csv.headerError ? (
              <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                {csv.fileName}: {csv.headerError}
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  {csv.fileName}: {csv.rows.length - csvErrors} row{csv.rows.length - csvErrors === 1 ? "" : "s"} ready
                  {csvErrors > 0 && (
                    <span className="font-medium text-rose-700 dark:text-rose-400">
                      {" "}
                      · {csvErrors} with errors (highlighted). Fix the file and upload it again. Nothing is saved until every row is valid.
                    </span>
                  )}
                </p>
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
                  <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700">
                    <thead className="bg-slate-50 dark:bg-slate-800">
                      <tr>
                        {["Row", "Date", "Member", "Description", "Stake", "Returns", "Check"].map((h) => (
                          <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-600 dark:text-slate-300">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {csv.rows.map((r) => (
                        <tr key={r.row} className={r.error ? "bg-rose-50 dark:bg-rose-900/30" : ""}>
                          <td className="px-2 py-1.5 tabular-nums">{r.row}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{r.cells.date}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{r.cells.member}</td>
                          <td className="px-2 py-1.5">{r.cells.description}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{r.cells.stake || "2.50 (default)"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{r.cells.returns}</td>
                          <td className={`px-2 py-1.5 ${r.error ? "font-medium text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                            {r.error ?? "OK"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={importCsv} disabled={!csvReady || saving || disabled} className={buttonClass}>
                    Save {csv.rows.length} result{csv.rows.length === 1 ? "" : "s"}
                  </button>
                  <button type="button" onClick={() => setCsv(null)} className="rounded-md px-3 py-2 text-sm text-slate-600 hover:underline dark:text-slate-300">
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white">Results entered</h2>
        {results.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
            No results yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  {["Date", "Member", "Description", "Stake", "Returns", "Result", "Counted", ""].map((h, i) => (
                    <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {results.map((r) => {
                  const counted = r.date >= cutoffDay;
                  const outcome = resultOutcome(r.stake, r.returns);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(dayToDate(r.date))}</td>
                      <td className="whitespace-nowrap px-3 py-2">{r.member}</td>
                      <td className="px-3 py-2">
                        {r.description || "-"}
                        {r.notes && <span className="block text-xs text-slate-500 dark:text-slate-400">{r.notes}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(r.stake)}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(r.returns)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{OUTCOME_LABEL[outcome]}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                        {counted ? "Yes" : "No (before cut-off)"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button type="button" onClick={() => remove(r)} disabled={disabled} className="text-rose-600 hover:underline disabled:opacity-60 dark:text-rose-400">
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Results dated on or after {formatDate(dayToDate(cutoffDay))} feed returns, member figures, the charts and the strike rate.
          Won = returns above the stake, void = returns equal to the stake, lost = returns below it. Results are shown on the{" "}
          <Link href="/" className="underline underline-offset-2">
            dashboard
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

