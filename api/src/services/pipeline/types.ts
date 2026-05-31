import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type CameraRole = "entry" | "floor" | "billing";

export type RunRequest = {
  clip_path: string;
  store_id: string;
  camera_id: string;
  camera_role: CameraRole;
  clip_start: string;
  sample_fps: number;
};

export type CameraRunSummary = {
  camera_id: string;
  events_written: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  duration_ms: number;
};

export type JobStatus = "uploaded" | "running" | "complete" | "failed" | "cancelled";
export type CameraJobStatus = "pending" | "running" | "complete" | "failed" | "cancelled";

export type UploadedCamera = {
  camera_id: string;
  camera_role: CameraRole;
  clip_path: string;
  output_path: string;
  filename: string;
  status: CameraJobStatus;
  events_written: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
};

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

export type PipelineJob = {
  job_id: string;
  store_id: string;
  clip_start: string;
  sample_fps: number;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  job_dir: string;
  upload_dir: string;
  output_dir: string;
  cameras: UploadedCamera[];
  live_metrics: LiveMetrics;
  customer_ids: Set<string>;
  staff_ids: Set<string>;
  summary: {
    total_events: number;
    accepted: number;
    duplicates: number;
    rejected: number;
    duration_ms: number;
  } | null;
  error: string | null;
  child: ChildProcessWithoutNullStreams | null;
};
