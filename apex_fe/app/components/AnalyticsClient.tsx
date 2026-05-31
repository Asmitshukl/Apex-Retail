"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./AppShell";
import { useLiveDashboard } from "./LiveDashboardProvider";
import { apiGet, formatNumber } from "../lib/api";

type Metrics = {
  unique_visitors: number;
  conversion_rate: number | null;
  queue_depth: number;
  abandonment_rate: number | null;
  avg_dwell_by_zone: Record<string, number>;
};

type FunnelStage = {
  stage: string;
  count: number;
  dropoff_pct: number;
};

type HeatmapZone = {
  zone_id: string;
  frequency: number;
  avg_dwell_ms: number;
  normalised_score: number;
};

type Anomaly = {
  type: string;
  severity: string;
  message: string;
  suggested_action: string;
};

export function AnalyticsClient() {
  const { job, metrics: liveMetrics } = useLiveDashboard();
  const [storeId, setStoreId] = useState("STORE_BLR_002");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [zones, setZones] = useState<HeatmapZone[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [status, setStatus] = useState("Load analytics after a processing job completes.");

  const loadAnalytics = useCallback(async (nextStoreId = storeId) => {
    setStatus("Loading analytics...");
    try {
      const [metricsData, funnelData, heatmapData, anomalyData] = await Promise.all([
        apiGet<Metrics & { store_id: string }>(`/stores/${nextStoreId}/metrics`),
        apiGet<{ funnel: FunnelStage[] }>(`/stores/${nextStoreId}/funnel`),
        apiGet<{ zones: HeatmapZone[] }>(`/stores/${nextStoreId}/heatmap`),
        apiGet<{ anomalies: Anomaly[] }>(`/stores/${nextStoreId}/anomalies`),
      ]);
      setMetrics(metricsData);
      setFunnel(funnelData.funnel);
      setZones(heatmapData.zones);
      setAnomalies(anomalyData.anomalies);
      setStatus(`Analytics loaded for ${nextStoreId}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load analytics.");
    }
  }, [storeId]);

  useEffect(() => {
    if (job?.store_id && job.store_id !== storeId) {
      setStoreId(job.store_id);
    }
  }, [job?.store_id, storeId]);

  useEffect(() => {
    if (job?.status === "complete") {
      void loadAnalytics(job.store_id);
    }
  }, [job?.status, job?.store_id, loadAnalytics]);

  useEffect(() => {
    void loadAnalytics(storeId);
  }, []);

  const topZone = useMemo(
    () => [...zones].sort((a, b) => b.normalised_score - a.normalised_score)[0] ?? null,
    [zones],
  );
  const totalZoneVisits = zones.reduce((sum, zone) => sum + zone.frequency, 0);
  const completedCameras = job?.cameras.filter((camera) => camera.status === "complete").length ?? 0;

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
            <p className="mt-2 text-slate-600">Final metrics, funnel, heatmap and anomaly checks from the latest processed upload.</p>
          </div>
          <div className="flex gap-3">
            <input
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              className="focus-ring h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
            <button onClick={() => loadAnalytics()} className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white">
              Load
            </button>
          </div>
        </section>

        <p className="text-sm text-slate-600">{status}</p>

        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Processing Summary</h2>
                <p className="mt-1 text-sm text-slate-500">Current upload job and final event ingestion status.</p>
              </div>
              <span className="soft-badge px-3 py-1 text-sm font-semibold">{job?.status ?? "no active job"}</span>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Job</p>
                <p className="mt-2 truncate text-sm font-semibold">{job?.job_id ?? "No job loaded"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Cameras</p>
                <p className="mt-2 text-2xl font-bold">{completedCameras}/{job?.cameras.length ?? 0}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Events</p>
                <p className="mt-2 text-2xl font-bold">{formatNumber(job?.summary?.total_events ?? liveMetrics.total_events)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Accepted</p>
                <p className="mt-2 text-2xl font-bold">{formatNumber(job?.summary?.accepted ?? 0)}</p>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-xl font-bold">Reviewer Notes</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Analytics are refreshed automatically when the upload job completes. New uploads clear the old store event set,
              so the dashboard and this page describe only the latest processed batch.
            </p>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <div className="card p-6">
            <p className="text-sm text-slate-500">Unique visitors</p>
            <p className="mt-2 text-3xl font-bold">{formatNumber(metrics?.unique_visitors ?? liveMetrics.unique_visitors)}</p>
          </div>
          <div className="card p-6">
            <p className="text-sm text-slate-500">Conversion rate</p>
            <p className="mt-2 text-3xl font-bold">{metrics?.conversion_rate === null || metrics?.conversion_rate === undefined ? "N/A" : `${Math.round(metrics.conversion_rate * 100)}%`}</p>
          </div>
          <div className="card p-6">
            <p className="text-sm text-slate-500">Queue depth</p>
            <p className="mt-2 text-3xl font-bold">{formatNumber(metrics?.queue_depth ?? liveMetrics.billing_queue)}</p>
          </div>
          <div className="card p-6">
            <p className="text-sm text-slate-500">Abandonment</p>
            <p className="mt-2 text-3xl font-bold">{metrics?.abandonment_rate === null || metrics?.abandonment_rate === undefined ? "N/A" : `${Math.round(metrics.abandonment_rate * 100)}%`}</p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="card p-6">
            <h2 className="text-xl font-bold">Funnel</h2>
            <div className="mt-5 space-y-4">
              {funnel.length === 0 ? (
                <p className="text-sm text-slate-500">No funnel stages available yet. Complete a processing job, then this section will show entry, zone visit, billing queue and purchase progression.</p>
              ) : funnel.map((stage) => (
                <div key={stage.stage}>
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">{stage.stage}</span>
                    <span>{stage.count} · {stage.dropoff_pct}% dropoff</span>
                  </div>
                  <div className="mt-2 h-2 rounded bg-slate-100">
                    <div className="h-2 rounded bg-emerald-500" style={{ width: `${Math.min(100, stage.count * 10)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Zone Heatmap</h2>
                <p className="mt-1 text-sm text-slate-500">{topZone ? `Top zone: ${topZone.zone_id}` : "No zone visits yet"}</p>
              </div>
              <span className="soft-badge px-3 py-1 text-sm font-semibold">{formatNumber(totalZoneVisits)} visits</span>
            </div>
            <div className="mt-5 space-y-4">
              {zones.length === 0 ? (
                <p className="text-sm text-slate-500">No zone movement has been stored yet.</p>
              ) : zones.slice(0, 6).map((zone) => (
                <div key={zone.zone_id} className="grid grid-cols-[1fr_80px] gap-3 text-sm">
                  <span className="font-semibold">{zone.zone_id}</span>
                  <span className="text-right">{zone.normalised_score}</span>
                  <div className="col-span-2 h-2 rounded bg-slate-100">
                    <div className="h-2 rounded bg-emerald-500" style={{ width: `${zone.normalised_score}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-xl font-bold">Anomalies</h2>
          <div className="mt-5 grid gap-4">
            {anomalies.length === 0 ? (
              <p className="text-sm text-slate-500">No anomalies detected for the loaded event set.</p>
            ) : anomalies.map((anomaly) => (
              <div key={`${anomaly.type}-${anomaly.message}`} className="rounded-lg border border-slate-200 p-4">
                <p className="font-semibold">{anomaly.type} · {anomaly.severity}</p>
                <p className="mt-1 text-sm text-slate-600">{anomaly.message}</p>
                <p className="mt-2 text-sm font-medium text-emerald-700">{anomaly.suggested_action}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
