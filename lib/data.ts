import fs from "node:fs";
import path from "node:path";

// Server-only helpers: these read the JSON files written by scripts/import-xlsx.py.

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export type Table = {
  title: string;
  range: string;
  columns: string[];
  rows: Row[];
};

export type SheetSummary = {
  name: string;
  slug: string;
  kind: string;
  tableCount: number;
  rowCount: number;
  columnCount: number;
};

export type DataIndex = {
  source: string | null;
  importedAt: string | null;
  sheets: SheetSummary[];
  omittedColumns: Record<string, string[]>;
  formulasWithoutCachedValue: number;
};

export type Sheet = {
  name: string;
  kind: string;
  tables: Table[];
};

const DATA_DIR = path.join(process.cwd(), "data");

export function getIndex(): DataIndex {
  const raw = fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf-8");
  return JSON.parse(raw) as DataIndex;
}

export function getSheet(slug: string): Sheet | null {
  // Only allow slugs that the index knows about (prevents path traversal).
  const known = getIndex().sheets.find((s) => s.slug === slug);
  if (!known) return null;
  const raw = fs.readFileSync(path.join(DATA_DIR, `${known.slug}.json`), "utf-8");
  return JSON.parse(raw) as Sheet;
}

/** The first table with this exact title, or null. */
export function findTable(sheet: Sheet | null, title: string): Table | null {
  return sheet?.tables.find((t) => t.title === title) ?? null;
}
