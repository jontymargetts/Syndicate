// Server-only: loads the TWOL (New) tracker from data/*.json. Used by pages and API routes.
import { getIndex, getSheet } from "@/lib/data";
import { type Tracker, parseTracker } from "@/lib/stats";

export const TRACKER_SHEET_NAME = "TWOL (New)";

export function loadTracker(): Tracker | null {
  const meta = getIndex().sheets.find((s) => s.name === TRACKER_SHEET_NAME);
  return parseTracker(meta ? getSheet(meta.slug) : null);
}
