"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DIRECT_API_BASE_URL, type EventLog, type LiveMetrics, type PipelineJob } from "../lib/api";

export type ChartPoint = {
  label: string;
  value: number;
};

type LiveDashboardSnapshot = {
  activeJobId: string;
  job: PipelineJob | null;
  metrics: LiveMetrics;
  logs: EventLog[];
  customerPoints: ChartPoint[];
  employeePoints: ChartPoint[];
  streamStatus: string;
  latestCustomerDelta: number;
  latestStaffDelta: number;
};

type LiveDashboardContextValue = LiveDashboardSnapshot & {
  setActiveJobId: (jobId: string) => void;
};

const storageKey = "apex_live_dashboard_state_v1";

export const emptyMetrics: LiveMetrics = {
  unique_visitors: 0,
  staff_seen: 0,
  customer_delta: 0,
  staff_delta: 0,
  entry_count: 0,
  exit_count: 0,
  billing_queue: 0,
  total_events: 0,
};

const initialSnapshot: LiveDashboardSnapshot = {
  activeJobId: "",
  job: null,
  metrics: emptyMetrics,
  logs: [
    {
      id: "welcome",
      type: "system",
      message: "Upload camera clips or open a job stream to begin live processing.",
      at: "--:--",
    },
  ],
  customerPoints: [{ label: "0s", value: 0 }],
  employeePoints: [{ label: "0s", value: 0 }],
  streamStatus: "Idle",
  latestCustomerDelta: 0,
  latestStaffDelta: 0,
};

const LiveDashboardContext = createContext<LiveDashboardContextValue | null>(null);

function timeLabel(): string {
  return new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
}

function logTime(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function normaliseMetrics(metrics: Partial<LiveMetrics> | null | undefined): LiveMetrics {
  return {
    ...emptyMetrics,
    ...(metrics ?? {}),
  };
}

function nextLog(type: string, message: string): EventLog {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    message,
    at: logTime(),
  };
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function LiveDashboardProvider({ children }: { children: ReactNode }) {
  const [activeJobId, setActiveJobIdState] = useState(initialSnapshot.activeJobId);
  const [job, setJob] = useState<PipelineJob | null>(initialSnapshot.job);
  const [metrics, setMetrics] = useState<LiveMetrics>(initialSnapshot.metrics);
  const [logs, setLogs] = useState<EventLog[]>(initialSnapshot.logs);
  const [customerPoints, setCustomerPoints] = useState<ChartPoint[]>(initialSnapshot.customerPoints);
  const [employeePoints, setEmployeePoints] = useState<ChartPoint[]>(initialSnapshot.employeePoints);
  const [streamStatus, setStreamStatus] = useState(initialSnapshot.streamStatus);
  const [latestCustomerDelta, setLatestCustomerDelta] = useState(initialSnapshot.latestCustomerDelta);
  const [latestStaffDelta, setLatestStaffDelta] = useState(initialSnapshot.latestStaffDelta);
  const [restored, setRestored] = useState(false);

  const pendingCustomerDelta = useRef(0);
  const pendingStaffDelta = useRef(0);
  const displayedCustomerActivity = useRef(0);
  const displayedStaffActivity = useRef(0);

  const pushLog = useCallback((type: string, message: string) => {
    setLogs((current) => [nextLog(type, message), ...current].slice(0, 24));
  }, []);

  const applyMetrics = useCallback((next: Partial<LiveMetrics> | null | undefined) => {
    const normalised = normaliseMetrics(next);
    setMetrics(normalised);
    if (normalised.customer_delta > 0) {
      pendingCustomerDelta.current += normalised.customer_delta;
    }
    if (normalised.staff_delta > 0) {
      pendingStaffDelta.current += normalised.staff_delta;
    }
  }, []);

  const applyMetricsWithoutDelta = useCallback((next: Partial<LiveMetrics> | null | undefined) => {
    setMetrics(normaliseMetrics(next));
  }, [activeJobId, job?.status]);

  const resetLiveState = useCallback((jobId: string) => {
    pendingCustomerDelta.current = 0;
    pendingStaffDelta.current = 0;
    displayedCustomerActivity.current = 0;
    displayedStaffActivity.current = 0;
    setJob(null);
    setMetrics(emptyMetrics);
    setLogs([
      nextLog("system", `Started a fresh dashboard session for ${jobId}.`),
    ]);
    setCustomerPoints(initialSnapshot.customerPoints);
    setEmployeePoints(initialSnapshot.employeePoints);
    setLatestCustomerDelta(0);
    setLatestStaffDelta(0);
  }, []);

  const setActiveJobId = useCallback((jobId: string) => {
    const cleanJobId = jobId.trim();
    if (cleanJobId && cleanJobId !== activeJobId) {
      resetLiveState(cleanJobId);
    }
    setActiveJobIdState(cleanJobId);
    if (cleanJobId) {
      setStreamStatus("Connecting");
    } else {
      setStreamStatus("Idle");
    }
  }, [activeJobId, resetLiveState]);

  useEffect(() => {
    const snapshot = safeJson<LiveDashboardSnapshot>(window.localStorage.getItem(storageKey));
    if (snapshot) {
      setActiveJobIdState(snapshot.activeJobId ?? "");
      setJob(snapshot.job ?? null);
      setMetrics(normaliseMetrics(snapshot.metrics));
      setLogs(snapshot.logs?.length ? snapshot.logs.slice(0, 24) : initialSnapshot.logs);
      setCustomerPoints(snapshot.customerPoints?.length ? snapshot.customerPoints.slice(-60) : initialSnapshot.customerPoints);
      setEmployeePoints(snapshot.employeePoints?.length ? snapshot.employeePoints.slice(-60) : initialSnapshot.employeePoints);
      setStreamStatus(snapshot.activeJobId ? "Connecting" : "Idle");
      setLatestCustomerDelta(snapshot.latestCustomerDelta ?? 0);
      setLatestStaffDelta(snapshot.latestStaffDelta ?? 0);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) {
      return;
    }
    const snapshot: LiveDashboardSnapshot = {
      activeJobId,
      job,
      metrics,
      logs,
      customerPoints,
      employeePoints,
      streamStatus,
      latestCustomerDelta,
      latestStaffDelta,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, [activeJobId, customerPoints, employeePoints, job, latestCustomerDelta, latestStaffDelta, logs, metrics, restored, streamStatus]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!activeJobId || job?.status !== "running") {
        return;
      }

      const customerTarget = pendingCustomerDelta.current;
      const staffTarget = pendingStaffDelta.current;
      pendingCustomerDelta.current = 0;
      pendingStaffDelta.current = 0;

      displayedCustomerActivity.current = Math.max(0, (displayedCustomerActivity.current * 0.58) + customerTarget);
      displayedStaffActivity.current = Math.max(0, (displayedStaffActivity.current * 0.58) + staffTarget);

      const label = timeLabel();
      setLatestCustomerDelta(customerTarget);
      setLatestStaffDelta(staffTarget);
      setCustomerPoints((current) => [...current.slice(-59), { label, value: Number(displayedCustomerActivity.current.toFixed(2)) }]);
      setEmployeePoints((current) => [...current.slice(-59), { label, value: Number(displayedStaffActivity.current.toFixed(2)) }]);
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!restored || !activeJobId) {
      return;
    }

    const source = new EventSource(`${DIRECT_API_BASE_URL}/pipeline/jobs/${activeJobId}/stream`);
    setStreamStatus("Connected");
    source.onopen = () => {
      setStreamStatus("Connected");
    };

    source.addEventListener("snapshot", (event) => {
      const nextJob = JSON.parse((event as MessageEvent).data) as PipelineJob;
      setJob(nextJob);
      applyMetricsWithoutDelta(nextJob.live_metrics);
      pushLog("snapshot", `Loaded job ${nextJob.job_id} with ${nextJob.cameras.length} cameras.`);
    });

    source.addEventListener("job_started", (event) => {
      const nextJob = JSON.parse((event as MessageEvent).data) as PipelineJob;
      setJob(nextJob);
      pushLog("job", `Processing started for ${nextJob.cameras.length} cameras.`);
    });

    source.addEventListener("batch_ingested", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        camera_id: string;
        accepted: number;
        duplicates: number;
        rejected: number;
        live_metrics?: LiveMetrics;
      };
      applyMetrics(payload.live_metrics);
      pushLog(
        "batch",
        `${payload.camera_id}: ${payload.accepted} accepted, ${payload.duplicates} duplicate, ${payload.rejected} rejected.`,
      );
    });

    source.addEventListener("live_metrics", (event) => {
      applyMetricsWithoutDelta(JSON.parse((event as MessageEvent).data) as LiveMetrics);
    });

    source.addEventListener("camera_started", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { camera_id: string; camera_role: string };
      pushLog("camera", `${payload.camera_id} started as ${payload.camera_role}.`);
    });

    source.addEventListener("camera_complete", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { camera_id: string; events_written: number };
      pushLog("camera", `${payload.camera_id} complete with ${payload.events_written} events.`);
    });

    source.addEventListener("job_complete", (event) => {
      const nextJob = JSON.parse((event as MessageEvent).data) as PipelineJob;
      setJob(nextJob);
      applyMetricsWithoutDelta(nextJob.live_metrics);
      setStreamStatus("Complete");
      pushLog("complete", `Job complete. ${nextJob.summary?.total_events ?? 0} events processed.`);
    });

    source.addEventListener("job_failed", (event) => {
      const nextJob = JSON.parse((event as MessageEvent).data) as PipelineJob;
      setJob(nextJob);
      setStreamStatus("Failed");
      pushLog("failed", nextJob.error ?? "Job failed.");
    });

    source.addEventListener("job_cancelled", (event) => {
      const nextJob = JSON.parse((event as MessageEvent).data) as PipelineJob;
      setJob(nextJob);
      setStreamStatus("Cancelled");
      pushLog("cancelled", "Job was cancelled.");
    });

    source.onerror = () => {
      setStreamStatus("Reconnecting");
    };

    return () => {
      source.close();
    };
  }, [activeJobId, applyMetrics, applyMetricsWithoutDelta, pushLog, restored]);

  const value = useMemo<LiveDashboardContextValue>(() => ({
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
  }), [activeJobId, customerPoints, employeePoints, job, latestCustomerDelta, latestStaffDelta, logs, metrics, streamStatus]);

  return (
    <LiveDashboardContext.Provider value={value}>
      {children}
    </LiveDashboardContext.Provider>
  );
}

export function useLiveDashboard() {
  const context = useContext(LiveDashboardContext);
  if (!context) {
    throw new Error("useLiveDashboard must be used inside LiveDashboardProvider");
  }
  return context;
}
