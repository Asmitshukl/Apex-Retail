"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "./AppShell";
import { emptyMetrics, useLiveDashboard } from "./LiveDashboardProvider";
import { LineChart } from "./LineChart";
import { MetricCard } from "./MetricCard";
import { API_BASE_URL, formatNumber } from "../lib/api";

type ZoneRow = {
  zone_id: string;
  frequency: number;
  avg_dwell_ms: number;
  normalised_score: number;
};

export function DashboardClient() {
  const {
    activeJobId,
    setActiveJobId,
    job,
    metrics,
    logs,
    customerPoints,
    employeePoints,
    streamStatus,
    latestCustomerDelta,
    latestStaffDelta,
  } = useLiveDashboard();
  const [jobIdInput, setJobIdInput] = useState("");
  const [zones, setZones] = useState<ZoneRow[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextJobId = params.get("job");
    if (nextJobId) {
      setActiveJobId(nextJobId);
      setJobIdInput(nextJobId);
    }
  }, [setActiveJobId]);

  useEffect(() => {
    setJobIdInput(activeJobId);
  }, [activeJobId]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/stores/STORE_BLR_002/heatmap`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.zones) {
          setZones(data.zones);
        }
      })
      .catch(() => undefined);
  }, []);

  const safeMetrics = metrics ?? emptyMetrics;
  const currentVisitors = Math.max(0, safeMetrics.entry_count - safeMetrics.exit_count);
  const zoneRows = useMemo(
    () => zones.length > 0 ? zones.slice(0, 5) : [
      { zone_id: "Makeup", frequency: 0, avg_dwell_ms: 0, normalised_score: 0 },
      { zone_id: "Billing", frequency: 0, avg_dwell_ms: 0, normalised_score: 0 },
      { zone_id: "F.O.H", frequency: 0, avg_dwell_ms: 0, normalised_score: 0 },
    ],
    [zones],
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
            <p className="mt-2 text-slate-600">
              Live customer and employee movement across uploaded CCTV camera angles.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={jobIdInput}
              onChange={(event) => setJobIdInput(event.target.value)}
              placeholder="Paste job id for stream"
              className="focus-ring h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
            <button
              onClick={() => setActiveJobId(jobIdInput)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold"
            >
              Open Stream
            </button>
            <span className="soft-badge px-3 py-2 text-sm font-semibold">{streamStatus}</span>
            <Link href="/add-video" className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white">
              Add Video
            </Link>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total Visitors" value={formatNumber(safeMetrics.unique_visitors)} hint="customer IDs seen" icon="↗" />
          <MetricCard label="Active Visitors" value={formatNumber(currentVisitors)} hint="entry minus exit" icon="◉" />
          <MetricCard label="Staff Detected" value={formatNumber(safeMetrics.staff_seen)} hint="LICM staff matches" icon="◆" />
          <MetricCard label="Billing Queue" value={formatNumber(safeMetrics.billing_queue)} hint="active queue estimate" icon="▣" />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <LineChart
            title="Customer Activity"
            subtitle="New customer IDs detected per live tick"
            points={customerPoints}
            valueLabel={formatNumber(Math.round(latestCustomerDelta))}
            valueHint="new customers"
          />
          <LineChart
            title="Employee Activity"
            subtitle="New staff IDs detected per live tick"
            points={employeePoints}
            color="#2563eb"
            valueLabel={formatNumber(Math.round(latestStaffDelta))}
            valueHint="new employees"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
          <div className="card p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">Summary</h2>
                <p className="mt-1 text-sm text-slate-500">Live pipeline logs and event activity</p>
              </div>
              <span className="soft-badge px-3 py-1 text-sm font-semibold">{job?.status ?? "no job"}</span>
            </div>
            <div className="mt-5 divide-y divide-slate-100">
              {logs.map((log) => (
                <div key={log.id} className="grid grid-cols-[84px_1fr] gap-3 py-3 text-sm">
                  <span className="text-slate-400">{log.at}</span>
                  <span>
                    <span className="font-semibold text-emerald-700">{log.type}</span>{" "}
                    <span className="text-slate-700">{log.message}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6">
            <div className="card p-6">
              <h2 className="text-lg font-bold">Entry Details</h2>
              <p className="mt-4 text-4xl font-bold">{formatNumber(safeMetrics.entry_count)}</p>
              <p className="mt-2 text-sm text-slate-500">ENTRY events received from entry cameras.</p>
            </div>
            <div className="card p-6">
              <h2 className="text-lg font-bold">Exit Details</h2>
              <p className="mt-4 text-4xl font-bold">{formatNumber(safeMetrics.exit_count)}</p>
              <p className="mt-2 text-sm text-slate-500">EXIT events and timeout exits from entry cameras.</p>
            </div>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 p-6">
            <div>
              <h2 className="text-xl font-bold">Aisle / Zone Visits</h2>
              <p className="mt-1 text-sm text-slate-500">Where visitors moved and how long they stayed</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-4">Zone</th>
                  <th className="px-6 py-4">Visits</th>
                  <th className="px-6 py-4">Avg dwell</th>
                  <th className="px-6 py-4">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {zoneRows.map((zone) => (
                  <tr key={zone.zone_id}>
                    <td className="px-6 py-4 font-semibold">{zone.zone_id}</td>
                    <td className="px-6 py-4">{zone.frequency}</td>
                    <td className="px-6 py-4">{Math.round(zone.avg_dwell_ms / 1000)}s</td>
                    <td className="px-6 py-4">
                      <div className="h-2 w-40 rounded bg-slate-100">
                        <div className="h-2 rounded bg-emerald-500" style={{ width: `${zone.normalised_score}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
