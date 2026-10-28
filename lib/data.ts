import fs from "node:fs";
import path from "node:path";

// Server-only helpers: these read the JSON files written by scripts/import-xlsx.py.

export type Row = Record<string, string | number | boolean | null>;

export type SheetSummary = {
  name: string;
  slug: string;
  rowCount: number;
  columnCount: number;
};

export type DataIndex = {
  source: string | null;
  importedAt: string | null;
  sheets: SheetSummary[];
  omittedColumns: Record<string, string[]>;
};

export type Sheet = {
  name: string;
  columns: string[];
  rows: Row[];
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
