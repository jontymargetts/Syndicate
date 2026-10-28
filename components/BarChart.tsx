"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatGBP } from "@/lib/stats";
import { useChartTheme } from "./chartTheme";

export type BarPoint = { label: string; value: number; detail?: string };

type TipPayload = { payload?: BarPoint };

function BarTooltip({ active, payload }: { active?: boolean; payload?: readonly TipPayload[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-800">
      <p className="font-medium text-slate-900 dark:text-white">{p.label}</p>
      {p.detail && <p className="text-slate-500 dark:text-slate-400">{p.detail}</p>}
      <p className="mt-1 text-slate-800 dark:text-slate-100">{formatGBP(p.value)}</p>
    </div>
  );
}

/**
 * Single-series bar chart (one hue, per the data-viz palette). Vertical bars for time periods,
 * horizontal bars for ranked lists. Bars are rounded at the data end and sit on the baseline.
 */
export default function BarChartView({
  data,
  orientation,
  height,
}: {
  data: BarPoint[];
  orientation: "vertical" | "horizontal";
  height: number;
}) {
  const t = useChartTheme();
  const horizontal = orientation === "horizontal";
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 8 : 0 }}
        >
          <CartesianGrid stroke={t.grid} horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tickFormatter={(v: number) => formatGBP(v)}
                tick={{ fill: t.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={72}
                tick={{ fill: t.text, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                tick={{ fill: t.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: t.zero }}
                minTickGap={8}
              />
              <YAxis
                tickFormatter={(v: number) => formatGBP(v)}
                tick={{ fill: t.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={80}
              />
            </>
          )}
          <Tooltip cursor={{ fill: t.grid, fillOpacity: 0.4 }} content={<BarTooltip />} />
          <Bar dataKey="value" radius={4} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={t.series} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
