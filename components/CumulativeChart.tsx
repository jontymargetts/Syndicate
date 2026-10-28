"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatGBP } from "@/lib/stats";
import { useChartTheme } from "./chartTheme";

export type CumulativePoint = { x: string; y: number; detail: string };

type TipPayload = { payload?: CumulativePoint };

function PointTooltip({ active, payload }: { active?: boolean; payload?: readonly TipPayload[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-800">
      <p className="font-medium text-slate-900 dark:text-white">{p.x}</p>
      <p className="text-slate-500 dark:text-slate-400">{p.detail}</p>
      <p className="mt-1 text-slate-800 dark:text-slate-100">Cumulative bet P&amp;L: {formatGBP(p.y)}</p>
    </div>
  );
}

/** Cumulative bet P&L line, one point per played week, with a crosshair tooltip and a zero line. */
export default function CumulativeChart({ data }: { data: CumulativePoint[] }) {
  const t = useChartTheme();
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis
            dataKey="x"
            tick={{ fill: t.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: t.zero }}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v: number) => formatGBP(v)}
            tick={{ fill: t.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={80}
          />
          <ReferenceLine y={0} stroke={t.zero} />
          <Tooltip cursor={{ stroke: t.axis }} content={<PointTooltip />} />
          <Line
            type="monotone"
            dataKey="y"
            stroke={t.series}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
