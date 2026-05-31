import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import { Router } from "express";
import { z } from "zod";

import prisma from "../db/client.js";
import { logger } from "../middleware/logger.js";
import { ingestEvents } from "./eventsService.js";
import { parseMultipartUpload } from "./pipeline/multipartUpload.js";
import type {
  CameraRunSummary,
  JobStatus,
  LiveMetrics,
  PipelineJob,
  RunRequest,
  UploadedCamera,
} from "./pipeline/types.js";

const router = Router();

const runRequestSchema = z.object({
  clip_path: z.string().min(1),
  store_id: z.string().min(1),
  camera_id: z.string().min(1),
  camera_role: z.enum(["entry", "floor", "billing"]),
  clip_start: z.string().datetime(),
  sample_fps: z.number().positive(),
});

const runAllRequestSchema = z.object({
  store_id: z.string().min(1),
  clip_start: z.string().datetime(),
});

const runLicmTestRequestSchema = z.object({
  camera_id: z.string().min(1).optional(),
});

const resetStoreRequestSchema = z.object({
  store_id: z.string().min(1),
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env["REPO_ROOT"]
  ? path.resolve(process.env["REPO_ROOT"])
  : path.resolve(__dirname, "../../..");
const outputDir = process.env["PIPELINE_OUTPUT_DIR"]
  ? path.resolve(process.env["PIPELINE_OUTPUT_DIR"])
  : path.join(repoRoot, "pipeline/output");
const uploadsDir = process.env["PIPELINE_UPLOADS_DIR"]
  ? path.resolve(process.env["PIPELINE_UPLOADS_DIR"])
  : path.join(repoRoot, "api/uploads/jobs");
const pipelinePython = process.env["PIPELINE_PYTHON"]
  ? path.resolve(process.env["PIPELINE_PYTHON"])
  : path.join(repoRoot, "pipeline/.venv/bin/python3");
const licmModelRelativePath = "pipeline/models/staff_classifier.onnx";
const licmClassesRelativePath = "pipeline/models/classes.txt";
const licmModelPath = path.join(repoRoot, licmModelRelativePath);
const licmClassesPath = path.join(repoRoot, licmClassesRelativePath);

let pipelineRunning = false;
let lastRunCompletedAt: string | null = null;
const jobs = new Map<string, PipelineJob>();
const jobStreams = new Map<string, Set<Response>>();

function registerJobChild(job: PipelineJob, child: ReturnType<typeof spawn>): void {
  job.children.push(child);
  job.child = child;
}

function unregisterJobChild(job: PipelineJob, child: ReturnType<typeof spawn>): void {
  job.children = job.children.filter((current) => current !== child);
  if (job.child === child) {
    job.child = job.children[job.children.length - 1] ?? null;
  }
}

function killJobChildren(job: PipelineJob): void {
  for (const child of job.children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore shutdown failures for individual workers.
    }
  }
}

function logPipeline(cameraId: string, message: string): void {
  process.stdout.write(`[PIPELINE][${cameraId}] ${message}\n`);
}

function streamPipelineOutput(cameraId: string, stream: NodeJS.ReadableStream): void {
  const lines = readline.createInterface({ input: stream });
  lines.on("line", (line) => {
    logPipeline(cameraId, line);
  });
}

async function readJsonlEvents(filePath: string): Promise<unknown[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function postEventBatches(cameraId: string, events: unknown[]): Promise<{ accepted: number; duplicates: number; rejected: number }> {
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  const batches: unknown[][] = [];
  for (let start = 0; start < events.length; start += 500) {
    batches.push(events.slice(start, start + 500));
  }

  for (const [index, batch] of batches.entries()) {
    logPipeline(cameraId, `Posting batch ${index + 1}/${batches.length} to /events/ingest`);
    const result = await ingestEvents({ events: batch });
    accepted += result.accepted;
    duplicates += result.duplicates;
    rejected += result.rejected;
    logPipeline(cameraId, `Accepted: ${result.accepted} Duplicates: ${result.duplicates} Rejected: ${result.rejected}`);
  }

  return { accepted, duplicates, rejected };
}

function isHeartbeatEvent(event: unknown): boolean {
  return (
    event !== null
    && typeof event === "object"
    && "visitor_id" in event
    && (event as { visitor_id?: unknown }).visitor_id === "STORE_HEARTBEAT"
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function eventVisitorId(event: unknown): string | null {
  if (!isObjectRecord(event) || typeof event["visitor_id"] !== "string") {
    return null;
  }
  return event["visitor_id"];
}

function eventIsStaff(event: unknown): boolean {
  return isObjectRecord(event) && event["is_staff"] === true;
}

function emptyLiveMetrics(): LiveMetrics {
  return {
    unique_visitors: 0,
    staff_seen: 0,
    customer_delta: 0,
    staff_delta: 0,
    entry_count: 0,
    exit_count: 0,
    billing_queue: 0,
    total_events: 0,
  };
}

function publicJob(job: PipelineJob) {
  return {
    job_id: job.job_id,
    store_id: job.store_id,
    clip_start: job.clip_start,
    sample_fps: job.sample_fps,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    cameras: job.cameras.map((camera) => ({
      camera_id: camera.camera_id,
      camera_role: camera.camera_role,
      filename: camera.filename,
      status: camera.status,
      events_written: camera.events_written,
      accepted: camera.accepted,
      duplicates: camera.duplicates,
      rejected: camera.rejected,
      error: camera.error,
      started_at: camera.started_at,
      completed_at: camera.completed_at,
    })),
    live_metrics: job.live_metrics,
    summary: job.summary,
    error: job.error,
  };
}

function sendSse(res: Response, type: string, payload: unknown): void {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastJob(job: PipelineJob, type: string, payload: unknown): void {
  const streams = jobStreams.get(job.job_id);
  if (!streams) {
    return;
  }
  for (const stream of streams) {
    sendSse(stream, type, payload);
  }
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^_+/, "") || "file";
}

function inferCameraRole(cameraId: string): "entry" | "floor" | "billing" {
  const normalized = cameraId.toLowerCase();
  if (normalized.includes("entry")) {
    return "entry";
  }
  if (normalized.includes("billing")) {
    return "billing";
  }
  return "floor";
}

function eventType(event: unknown): string | null {
  if (!isObjectRecord(event) || typeof event["event_type"] !== "string") {
    return null;
  }
  return event["event_type"];
}

function updateLiveMetrics(job: PipelineJob, events: unknown[]): void {
  let customerDelta = 0;
  let staffDelta = 0;
  let entryCount = 0;
  let exitCount = 0;
  let billingQueue = job.live_metrics.billing_queue;

  for (const event of events) {
    const visitorId = eventVisitorId(event);
    const staffEvent = eventIsStaff(event);
    const heartbeatEvent = isHeartbeatEvent(event);

    if (visitorId && staffEvent && !job.staff_ids.has(visitorId)) {
      job.staff_ids.add(visitorId);
      staffDelta += 1;
    } else if (visitorId && !staffEvent && !heartbeatEvent && !job.customer_ids.has(visitorId)) {
      job.customer_ids.add(visitorId);
      customerDelta += 1;
    }

    const type = eventType(event);
    if (!staffEvent && type === "ENTRY") {
      entryCount += 1;
    } else if (!staffEvent && type === "EXIT") {
      exitCount += 1;
    } else if (!staffEvent && type === "BILLING_QUEUE_JOIN") {
      billingQueue += 1;
    } else if (!staffEvent && (type === "BILLING_QUEUE_ABANDON" || type === "EXIT")) {
      billingQueue = Math.max(0, billingQueue - 1);
    }
  }

  job.live_metrics.unique_visitors = job.customer_ids.size;
  job.live_metrics.staff_seen = job.staff_ids.size;
  job.live_metrics.customer_delta = customerDelta;
  job.live_metrics.staff_delta = staffDelta;
  job.live_metrics.entry_count += entryCount;
  job.live_metrics.exit_count += exitCount;
  job.live_metrics.billing_queue = billingQueue;
  job.live_metrics.total_events += events.length;
}

async function runPipeline(request: RunRequest): Promise<CameraRunSummary> {
  const startedAt = performance.now();
  const outputPath = path.join(outputDir, `${request.camera_id}.jsonl`);
  await fs.mkdir(outputDir, { recursive: true });

  const args = [
    "pipeline/detect.py",
    "--clip",
    request.clip_path,
    "--store-id",
    request.store_id,
    "--camera-id",
    request.camera_id,
    "--camera-role",
    request.camera_role,
    "--layout",
    "pipeline/data/store_layout.json",
    "--output",
    `pipeline/output/${request.camera_id}.jsonl`,
    "--clip-start",
    request.clip_start,
    "--pos-file",
    "pipeline/data/pos_transactions.csv",
    "--sample-fps",
    String(request.sample_fps),
  ];

  logPipeline(request.camera_id, `Starting ${pipelinePython} ${args.join(" ")}`);
  const child = spawn(pipelinePython, args, {
    cwd: repoRoot,
    env: process.env,
  });

  let stderrOutput = "";
  streamPipelineOutput(request.camera_id, child.stdout);
  child.stderr.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });
  streamPipelineOutput(request.camera_id, child.stderr);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(stderrOutput || `Pipeline failed with exit code ${exitCode ?? "unknown"}`);
  }

  const events = await readJsonlEvents(outputPath);
  logPipeline(request.camera_id, `Wrote ${events.length} events to output file`);
  const ingest = await postEventBatches(request.camera_id, events);

  return {
    camera_id: request.camera_id,
    events_written: events.length,
    accepted: ingest.accepted,
    duplicates: ingest.duplicates,
    rejected: ingest.rejected,
    duration_ms: Math.round(performance.now() - startedAt),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function ingestNewEventsForJob(
  job: PipelineJob,
  camera: UploadedCamera,
  events: unknown[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  for (let start = 0; start < events.length; start += 500) {
    const batch = events.slice(start, start + 500);
    const result = await ingestEvents({ events: batch });
    camera.accepted += result.accepted;
    camera.duplicates += result.duplicates;
    camera.rejected += result.rejected;
    updateLiveMetrics(job, batch);
    broadcastJob(job, "batch_ingested", {
      job_id: job.job_id,
      camera_id: camera.camera_id,
      batch_size: batch.length,
      accepted: result.accepted,
      duplicates: result.duplicates,
      rejected: result.rejected,
      live_metrics: job.live_metrics,
    });
    broadcastJob(job, "live_metrics", job.live_metrics);
  }
}

async function runUploadedCamera(job: PipelineJob, camera: UploadedCamera): Promise<void> {
  const startedAt = performance.now();
  camera.status = "running";
  camera.started_at = new Date().toISOString();
  broadcastJob(job, "camera_started", {
    job_id: job.job_id,
    camera_id: camera.camera_id,
    camera_role: camera.camera_role,
  });

  await fs.mkdir(path.dirname(camera.output_path), { recursive: true });
  await fs.writeFile(camera.output_path, "");

  const outputRelativePath = path.relative(repoRoot, camera.output_path);
  const args = [
    "pipeline/detect.py",
    "--clip",
    camera.clip_path,
    "--store-id",
    job.store_id,
    "--camera-id",
    camera.camera_id,
    "--camera-role",
    camera.camera_role,
    "--layout",
    "pipeline/data/store_layout.json",
    "--output",
    outputRelativePath,
    "--clip-start",
    job.clip_start,
    "--pos-file",
    "pipeline/data/pos_transactions.csv",
    "--sample-fps",
    String(job.sample_fps),
    "--live-mode",
  ];

  logPipeline(camera.camera_id, `Starting uploaded job ${job.job_id}: ${pipelinePython} ${args.join(" ")}`);
  const child = spawn(pipelinePython, args, {
    cwd: repoRoot,
    env: process.env,
  });
  registerJobChild(job, child);
  try {
    let stderrOutput = "";
    let exitCode: number | null | undefined;
    streamPipelineOutput(camera.camera_id, child.stdout);
    child.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });
    streamPipelineOutput(camera.camera_id, child.stderr);
    child.on("close", (code) => {
      exitCode = code;
    });

    let processedEvents = 0;
    while (exitCode === undefined) {
      const events = await readJsonlEvents(camera.output_path);
      const newEvents = events.slice(processedEvents).filter((event) => !isHeartbeatEvent(event));
      processedEvents = events.length;
      camera.events_written = events.length;
      await ingestNewEventsForJob(job, camera, newEvents);
      await sleep(1000);
    }

    const events = await readJsonlEvents(camera.output_path);
    const newEvents = events.slice(processedEvents).filter((event) => !isHeartbeatEvent(event));
    processedEvents = events.length;
    camera.events_written = events.length;
    await ingestNewEventsForJob(job, camera, newEvents);

    if (exitCode !== 0) {
      throw new Error(stderrOutput || `Pipeline failed with exit code ${exitCode ?? "unknown"}`);
    }

    camera.status = "complete";
    camera.completed_at = new Date().toISOString();
    broadcastJob(job, "camera_complete", {
      job_id: job.job_id,
      camera_id: camera.camera_id,
      events_written: camera.events_written,
      accepted: camera.accepted,
      duplicates: camera.duplicates,
      rejected: camera.rejected,
      duration_ms: Math.round(performance.now() - startedAt),
    });
  } finally {
    unregisterJobChild(job, child);
  }
}

async function runUploadedJob(job: PipelineJob): Promise<void> {
  const startedAt = performance.now();
  job.status = "running";
  job.started_at = new Date().toISOString();
  broadcastJob(job, "job_started", publicJob(job));

  try {
    logPipeline(job.job_id, `Starting ${job.cameras.length} uploaded camera workers in parallel`);
    await Promise.all(job.cameras.map(async (camera) => {
      if ((job.status as JobStatus) === "cancelled") {
        camera.status = "cancelled";
        return;
      }
      await runUploadedCamera(job, camera);
    }));

    if ((job.status as JobStatus) !== "cancelled") {
      job.status = "complete";
    }
    job.completed_at = new Date().toISOString();
    job.child = null;
    job.summary = {
      total_events: job.cameras.reduce((sum, camera) => sum + camera.events_written, 0),
      accepted: job.cameras.reduce((sum, camera) => sum + camera.accepted, 0),
      duplicates: job.cameras.reduce((sum, camera) => sum + camera.duplicates, 0),
      rejected: job.cameras.reduce((sum, camera) => sum + camera.rejected, 0),
      duration_ms: Math.round(performance.now() - startedAt),
    };
    broadcastJob(job, "job_complete", publicJob(job));
  } catch (err) {
    killJobChildren(job);
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Pipeline job failed";
    job.completed_at = new Date().toISOString();
    job.child = null;
    for (const camera of job.cameras) {
      if (camera.status !== "complete") {
        camera.status = "failed";
        camera.error = job.error;
        camera.completed_at = job.completed_at;
      }
    }
    logger.error(err, "Uploaded pipeline job failed");
    broadcastJob(job, "job_failed", publicJob(job));
  }
}

function brigadeCameraRuns(storeId: string, clipStart: string): RunRequest[] {
  const clipsDir = "pipeline/data/clips/CCTV Footage";
  return [
    {
      clip_path: `${clipsDir}/CAM_ENTRY_01.mp4`,
      store_id: storeId,
      camera_id: "CAM_ENTRY_01",
      camera_role: "entry",
      clip_start: clipStart,
      sample_fps: 3,
    },
    {
      clip_path: `${clipsDir}/CAM_FLOOR_01.mp4`,
      store_id: storeId,
      camera_id: "CAM_FLOOR_01",
      camera_role: "floor",
      clip_start: clipStart,
      sample_fps: 3,
    },
    {
      clip_path: `${clipsDir}/CAM_FLOOR_02.mp4`,
      store_id: storeId,
      camera_id: "CAM_FLOOR_02",
      camera_role: "floor",
      clip_start: clipStart,
      sample_fps: 3,
    },
    {
      clip_path: `${clipsDir}/CAM_FLOOR_03.mp4`,
      store_id: storeId,
      camera_id: "CAM_FLOOR_03",
      camera_role: "floor",
      clip_start: clipStart,
      sample_fps: 3,
    },
    {
      clip_path: `${clipsDir}/CAM_BILLING_01.mp4`,
      store_id: storeId,
      camera_id: "CAM_BILLING_01",
      camera_role: "billing",
      clip_start: "2026-04-16T08:14:00Z",
      sample_fps: 1,
    },
  ];
}

function cameraRunForId(cameraId: string): RunRequest | null {
  return brigadeCameraRuns("STORE_BLR_002", "2026-04-16T08:00:00Z").find(
    (camera) => camera.camera_id === cameraId,
  ) ?? null;
}

router.post("/jobs/upload", async (req, res) => {
  const jobId = `job_${randomUUID()}`;
  const jobDir = path.join(uploadsDir, jobId);
  const uploadDir = path.join(jobDir, "videos");
  const jobOutputDir = path.join(jobDir, "output");

  try {
    const parsedUpload = await parseMultipartUpload(req, uploadDir);
    const storeId = parsedUpload.fields["store_id"]?.trim() || "STORE_BLR_002";
    const clipStart = parsedUpload.fields["clip_start"]?.trim() || new Date().toISOString();
    const sampleFps = Number(parsedUpload.fields["sample_fps"] ?? 3);
    const autoStart = ["1", "true", "yes"].includes((parsedUpload.fields["auto_start"] ?? "").toLowerCase());
    const cameraRoles = parsedUpload.fields["camera_roles"]
      ? JSON.parse(parsedUpload.fields["camera_roles"]) as Record<string, "entry" | "floor" | "billing">
      : {};

    if (parsedUpload.files.length === 0) {
      res.status(400).json({ error: "At least one uploaded video file is required" });
      return;
    }

    const resetResult = await prisma.event.deleteMany({
      where: { storeId },
    });
    logger.info(
      { store_id: storeId, deleted_events: resetResult.count, job_id: jobId },
      "Cleared previous store events before new upload job",
    );

    await fs.mkdir(jobOutputDir, { recursive: true });
    const cameras: UploadedCamera[] = parsedUpload.files.map((file) => {
      const rawCameraId = ["video", "videos", "file", "files"].includes(file.fieldName)
        ? path.basename(file.filename, path.extname(file.filename))
        : file.fieldName;
      const cameraId = safeName(rawCameraId).toUpperCase();
      return {
        camera_id: cameraId,
        camera_role: cameraRoles[cameraId] ?? inferCameraRole(cameraId),
        clip_path: file.path,
        output_path: path.join(jobOutputDir, `${cameraId}.jsonl`),
        filename: file.filename,
        status: "pending",
        events_written: 0,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
        error: null,
        started_at: null,
        completed_at: null,
      };
    });

    const job: PipelineJob = {
      job_id: jobId,
      store_id: storeId,
      clip_start: clipStart,
      sample_fps: Number.isFinite(sampleFps) && sampleFps > 0 ? sampleFps : 3,
      status: "uploaded",
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      job_dir: jobDir,
      upload_dir: uploadDir,
      output_dir: jobOutputDir,
      cameras,
      live_metrics: emptyLiveMetrics(),
      customer_ids: new Set<string>(),
      staff_ids: new Set<string>(),
      summary: null,
      error: null,
      child: null,
      children: [],
    };

    jobs.set(jobId, job);
    await fs.writeFile(path.join(jobDir, "manifest.json"), JSON.stringify(publicJob(job), null, 2));

    if (autoStart) {
      void runUploadedJob(job);
    }

    res.status(201).json(publicJob(job));
  } catch (err) {
    logger.error(err, "Pipeline upload failed");
    res.status(400).json({
      error: err instanceof Error ? err.message : "Upload failed",
    });
  }
});

router.get("/jobs/:jobId", (req, res) => {
  const jobId = req.params["jobId"];
  const job = jobId ? jobs.get(jobId) : undefined;
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(publicJob(job));
});

router.get("/jobs/:jobId/stream", (req, res) => {
  const jobId = req.params["jobId"];
  const job = jobId ? jobs.get(jobId) : undefined;
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let streams = jobStreams.get(job.job_id);
  if (!streams) {
    streams = new Set<Response>();
    jobStreams.set(job.job_id, streams);
  }
  streams.add(res);
  sendSse(res, "snapshot", publicJob(job));

  const heartbeat = setInterval(() => {
    sendSse(res, "heartbeat", { job_id: job.job_id, at: new Date().toISOString() });
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    streams.delete(res);
  });
});

router.post("/jobs/:jobId/start", (req, res) => {
  const jobId = req.params["jobId"];
  const job = jobId ? jobs.get(jobId) : undefined;
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status === "running") {
    res.status(409).json({ error: "Job is already running" });
    return;
  }
  if (job.status === "complete") {
    res.status(409).json({ error: "Job is already complete" });
    return;
  }

  void runUploadedJob(job);
  res.json(publicJob(job));
});

router.post("/jobs/:jobId/cancel", (req, res) => {
  const jobId = req.params["jobId"];
  const job = jobId ? jobs.get(jobId) : undefined;
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  job.status = "cancelled";
  job.completed_at = new Date().toISOString();
  killJobChildren(job);
  job.child = null;
  for (const camera of job.cameras) {
    if (camera.status === "running" || camera.status === "pending") {
      camera.status = "cancelled";
      camera.completed_at = job.completed_at;
    }
  }
  broadcastJob(job, "job_cancelled", publicJob(job));
  res.json(publicJob(job));
});

router.post("/run", async (req, res) => {
  if (pipelineRunning) {
    res.status(409).json({ error: "Pipeline is already running" });
    return;
  }

  const parsed = runRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pipeline request", details: parsed.error.issues });
    return;
  }

  try {
    pipelineRunning = true;
    const summary = await runPipeline(parsed.data);
    lastRunCompletedAt = new Date().toISOString();
    res.json({
      status: "complete",
      camera_id: summary.camera_id,
      events_written: summary.events_written,
      accepted: summary.accepted,
      duplicates: summary.duplicates,
      rejected: summary.rejected,
      duration_ms: summary.duration_ms,
    });
  } catch (err) {
    logger.error(err, "Pipeline run failed");
    res.status(500).json({
      status: "failed",
      error: err instanceof Error ? err.message : "Pipeline failed",
    });
  } finally {
    pipelineRunning = false;
  }
});

router.post("/run-all", async (req, res) => {
  if (pipelineRunning) {
    res.status(409).json({ error: "Pipeline is already running" });
    return;
  }

  const parsed = runAllRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pipeline request", details: parsed.error.issues });
    return;
  }

  const startedAt = performance.now();
  const perCamera: CameraRunSummary[] = [];
  try {
    pipelineRunning = true;
    const cameraRuns = brigadeCameraRuns(parsed.data.store_id, parsed.data.clip_start);
    logPipeline("RUN_ALL", `Starting ${cameraRuns.length} camera workers in parallel`);
    perCamera.push(...await Promise.all(cameraRuns.map((camera) => runPipeline(camera))));
    lastRunCompletedAt = new Date().toISOString();
    res.json({
      status: "complete",
      store_id: parsed.data.store_id,
      cameras_processed: perCamera.length,
      total_events_accepted: perCamera.reduce((sum, camera) => sum + camera.accepted, 0),
      total_events_duplicates: perCamera.reduce((sum, camera) => sum + camera.duplicates, 0),
      total_events_rejected: perCamera.reduce((sum, camera) => sum + camera.rejected, 0),
      per_camera: perCamera,
      total_duration_ms: Math.round(performance.now() - startedAt),
    });
  } catch (err) {
    logger.error(err, "Pipeline run-all failed");
    res.status(500).json({
      status: "failed",
      store_id: parsed.data.store_id,
      per_camera: perCamera,
      error: err instanceof Error ? err.message : "Pipeline failed",
    });
  } finally {
    pipelineRunning = false;
  }
});

router.post("/ingest-existing", async (_req, res) => {
  await fs.mkdir(outputDir, { recursive: true });
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const perFile: Array<{
    file: string;
    event_count: number;
    accepted: number;
    duplicates: number;
    rejected: number;
  }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const filePath = path.join(outputDir, entry.name);
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      continue;
    }

    const events = (await readJsonlEvents(filePath)).filter((event) => !isHeartbeatEvent(event));
    const ingest = await postEventBatches(path.basename(entry.name, ".jsonl"), events);
    perFile.push({
      file: path.relative(repoRoot, filePath),
      event_count: events.length,
      accepted: ingest.accepted,
      duplicates: ingest.duplicates,
      rejected: ingest.rejected,
    });
  }

  res.json({
    status: "complete",
    total_accepted: perFile.reduce((sum, file) => sum + file.accepted, 0),
    total_duplicates: perFile.reduce((sum, file) => sum + file.duplicates, 0),
    total_rejected: perFile.reduce((sum, file) => sum + file.rejected, 0),
    per_file: perFile,
  });
});

router.get("/debug/event-types", async (_req, res) => {
  const byType = await prisma.event.groupBy({
    by: ["eventType"],
    where: { storeId: "STORE_BLR_002" },
    _count: { eventType: true },
  });
  res.json(byType);
});

router.post("/reset-store", async (req, res) => {
  const parsed = resetStoreRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid reset request", details: parsed.error.issues });
    return;
  }

  const result = await prisma.event.deleteMany({
    where: { storeId: parsed.data.store_id },
  });
  logger.info(`Deleted ${result.count} events for store ${parsed.data.store_id}`);
  res.json({
    store_id: parsed.data.store_id,
    deleted_events: result.count,
  });
});

router.get("/licm-status", async (_req, res) => {
  let modelSizeBytes: number | null = null;
  let licmModelLoaded = false;
  let classes = ["customer", "staff"];

  try {
    const stat = await fs.stat(licmModelPath);
    licmModelLoaded = stat.isFile();
    modelSizeBytes = licmModelLoaded ? stat.size : null;
  } catch {
    licmModelLoaded = false;
  }

  try {
    const classesContent = await fs.readFile(licmClassesPath, "utf8");
    const parsedClasses = classesContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (parsedClasses.length > 0) {
      classes = parsedClasses;
    }
  } catch {
    classes = ["customer", "staff"];
  }

  res.json({
    licm_model_loaded: licmModelLoaded,
    model_path: licmModelRelativePath,
    model_size_bytes: modelSizeBytes,
    classes,
    accuracy: "90.5%",
    architecture: "ResNet18",
    training_samples: 473,
    fallback: "HSV heuristic",
  });
});

router.post("/run-licm-test", async (req, res) => {
  if (pipelineRunning) {
    res.status(409).json({ error: "Pipeline is already running" });
    return;
  }

  const parsed = runLicmTestRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid LICM test request", details: parsed.error.issues });
    return;
  }

  const cameraId = parsed.data.camera_id ?? "CAM_FLOOR_01";
  const cameraRun = cameraRunForId(cameraId);
  if (!cameraRun) {
    res.status(404).json({ error: `Unknown camera_id: ${cameraId}` });
    return;
  }

  try {
    pipelineRunning = true;
    const summary = await runPipeline(cameraRun);
    lastRunCompletedAt = new Date().toISOString();

    const outputPath = path.join(outputDir, `${cameraId}.jsonl`);
    const events = await readJsonlEvents(outputPath);
    const staffEvents = events.filter(eventIsStaff);
    const visitorEvents = events.filter((event) => !eventIsStaff(event) && !isHeartbeatEvent(event));
    const uniqueStaffIds = new Set(staffEvents.map(eventVisitorId).filter((id): id is string => id !== null));
    const uniqueVisitorIds = new Set(visitorEvents.map(eventVisitorId).filter((id): id is string => id !== null));

    res.json({
      status: "complete",
      camera_id: cameraId,
      total_events: events.length,
      staff_events: staffEvents.length,
      visitor_events: visitorEvents.length,
      unique_staff_ids: uniqueStaffIds.size,
      unique_visitor_ids: uniqueVisitorIds.size,
      licm_active: (await fs.stat(licmModelPath).then((stat) => stat.isFile()).catch(() => false)),
      sample_staff_event: staffEvents[0] ?? null,
      sample_visitor_event: visitorEvents[0] ?? null,
      duration_ms: summary.duration_ms,
    });
  } catch (err) {
    logger.error(err, "LICM test run failed");
    res.status(500).json({
      status: "failed",
      camera_id: cameraId,
      error: err instanceof Error ? err.message : "LICM test failed",
    });
  } finally {
    pipelineRunning = false;
  }
});

router.get("/status", async (_req, res) => {
  await fs.mkdir(outputDir, { recursive: true });
  const [eventsInDb, stores, outputEntries] = await Promise.all([
    prisma.event.count(),
    prisma.event.findMany({
      distinct: ["storeId"],
      select: { storeId: true },
      orderBy: { storeId: "asc" },
    }),
    fs.readdir(outputDir, { withFileTypes: true }),
  ]);

  const outputFiles = await Promise.all(
    outputEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map(async (entry) => {
        const file = path.join(outputDir, entry.name);
        const [stat, events] = await Promise.all([fs.stat(file), readJsonlEvents(file)]);
        return {
          camera_id: path.basename(entry.name, ".jsonl"),
          file: path.relative(repoRoot, file),
          size_bytes: stat.size,
          event_count: events.length,
        };
      }),
  );

  res.json({
    pipeline_running: pipelineRunning,
    last_run_completed_at: lastRunCompletedAt,
    events_in_db: eventsInDb,
    stores_with_data: stores.map((store) => store.storeId),
    output_files: outputFiles,
  });
});

export default router;
