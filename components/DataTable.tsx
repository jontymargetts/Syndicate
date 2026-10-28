"use client";

import { useMemo, useState } from "react";
import type { Row } from "@/lib/data";

type SortState = { column: string; dir: "asc" | "desc" } | null;

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1; // blanks last
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function display(v: Row[string]): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export default function DataTable({ columns, rows }: { columns: string[]; rows: Row[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q
      ? rows.filter((r) => columns.some((c) => display(r[c]).toLowerCase().includes(q)))
      : rows;
    if (sort) {
      const { column, dir } = sort;
      out = [...out].sort((a, b) => {
        const c = compare(a[column], b[column]);
        return dir === "asc" ? c : -c;
      });
    }
    return out;
  }, [rows, columns, query, sort]);

  function toggleSort(column: string) {
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all columns..."
          aria-label="Search table"
          className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {visible.length} of {rows.length} rows
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              {columns.map((c) => {
                const active = sort?.column === c;
                return (
                  <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                    <button
                      type="button"
                      onClick={() => toggleSort(c)}
                      className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      {c}
                      <span aria-hidden className="text-xs">
                        {active ? (sort?.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {visible.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                {columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-3 py-2 text-slate-700 dark:text-slate-200">
                    {display(row[c])}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={Math.max(columns.length, 1)} className="px-3 py-6 text-center text-slate-500">
                  No matching rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
