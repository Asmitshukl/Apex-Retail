import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { z } from "zod";

import prisma from "../db/client.js";
import { logger } from "../middleware/logger.js";
import { ingestEvents } from "../services/eventsService.js";

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

type RunRequest = z.infer<typeof runRequestSchema>;

type CameraRunSummary = {
  camera_id: string;
  events_written: number;
  accepted: number;
  rejected: number;
  duration_ms: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const outputDir = path.join(repoRoot, "pipeline/output");
const pipelinePython = "/home/shuklaZod/store-intelligence/pipeline/.venv/bin/python3";

let pipelineRunning = false;
let lastRunCompletedAt: string | null = null;

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

async function postEventBatches(cameraId: string, events: unknown[]): Promise<{ accepted: number; rejected: number }> {
  let accepted = 0;
  let rejected = 0;
  const batches: unknown[][] = [];
  for (let start = 0; start < events.length; start += 500) {
    batches.push(events.slice(start, start + 500));
  }

  for (const [index, batch] of batches.entries()) {
    logPipeline(cameraId, `Posting batch ${index + 1}/${batches.length} to /events/ingest`);
    const result = await ingestEvents({ events: batch });
    accepted += result.accepted;
    rejected += result.rejected;
    logPipeline(cameraId, `Accepted: ${result.accepted} Rejected: ${result.rejected}`);
  }

  return { accepted, rejected };
}

function isHeartbeatEvent(event: unknown): boolean {
  return (
    event !== null
    && typeof event === "object"
    && "visitor_id" in event
    && (event as { visitor_id?: unknown }).visitor_id === "STORE_HEARTBEAT"
  );
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
    cwd: path.resolve(__dirname, "../../.."),
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
    rejected: ingest.rejected,
    duration_ms: Math.round(performance.now() - startedAt),
  };
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
    for (const camera of brigadeCameraRuns(parsed.data.store_id, parsed.data.clip_start)) {
      perCamera.push(await runPipeline(camera));
    }
    lastRunCompletedAt = new Date().toISOString();
    res.json({
      status: "complete",
      store_id: parsed.data.store_id,
      cameras_processed: perCamera.length,
      total_events_accepted: perCamera.reduce((sum, camera) => sum + camera.accepted, 0),
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
      rejected: ingest.rejected,
    });
  }

  res.json({
    status: "complete",
    total_accepted: perFile.reduce((sum, file) => sum + file.accepted, 0),
    total_rejected: perFile.reduce((sum, file) => sum + file.rejected, 0),
    per_file: perFile,
  });
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
