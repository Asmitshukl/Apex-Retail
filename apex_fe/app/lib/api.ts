export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return "http://localhost:3001";
}

export function getDirectApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return "http://localhost:3001";
}

export const API_BASE_URL = getApiBaseUrl();
export const DIRECT_API_BASE_URL = getDirectApiBaseUrl();

export type LiveMetrics = {
  unique_visitors: number;
  staff_seen: number;
  customer_delta: number;
  staff_delta: number;
  entry_count: number;
  exit_count: number;
  billing_queue: number;
  total_events: number;
};

export type CameraJob = {
  camera_id: string;
  camera_role: "entry" | "floor" | "billing";
  filename: string;
  status: string;
  events_written: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type UploadProgress = {
  uploaded_bytes: number;
  total_bytes: number | null;
  percent: number;
  status: "waiting" | "uploading" | "complete" | "failed";
};

export type PipelineJob = {
  job_id: string;
  store_id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cameras: CameraJob[];
  upload_progress: UploadProgress;
  live_metrics: LiveMetrics;
  summary: {
    total_events: number;
    accepted: number;
    duplicates: number;
    rejected: number;
    duration_ms: number;
  } | null;
  error: string | null;
};

export type EventLog = {
  id: string;
  type: string;
  message: string;
  at: string;
};

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0";
  }
  return new Intl.NumberFormat("en-IN").format(value);
}
