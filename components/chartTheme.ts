"use client";

import { useEffect, useState } from "react";

// Chart colours from the data-viz reference palette (dataviz skill, references/palette.md).
// Charts here use a single series, so only categorical slot 1 (blue) is needed plus neutral chrome.
// Dark values follow the OS setting, the same as the rest of the site.
export type ChartTheme = {
  series: string;
  grid: string;
  axis: string;
  text: string;
  zero: string;
  surface: string;
};

export const LIGHT_THEME: ChartTheme = {
  series: "#2a78d6",
  grid: "#e1e0d9",
  axis: "#898781",
  text: "#52514e",
  zero: "#c3c2b7",
  surface: "#fcfcfb",
};

export const DARK_THEME: ChartTheme = {
  series: "#3987e5",
  grid: "#2c2c2a",
  axis: "#898781",
  text: "#c3c2b7",
  zero: "#383835",
  surface: "#1a1a19",
};

/** Returns the chart theme for the viewer's OS colour scheme. Light on the server and first paint. */
export function useChartTheme(): ChartTheme {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark ? DARK_THEME : LIGHT_THEME;
}
