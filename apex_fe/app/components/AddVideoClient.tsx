"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "./AppShell";
import { useLiveDashboard } from "./LiveDashboardProvider";
import { DIRECT_API_BASE_URL, type PipelineJob } from "../lib/api";

type UploadItem = {
  file: File;
  cameraId: string;
  role: "entry" | "floor" | "billing";
};

function inferRole(name: string): UploadItem["role"] {
  const lower = name.toLowerCase();
  if (lower.includes("entry")) {
    return "entry";
  }
  if (lower.includes("billing")) {
    return "billing";
  }
  return "floor";
}

function cameraIdFromFile(file: File) {
  return file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_.-]/g, "_").toUpperCase();
}

export function AddVideoClient() {
  const router = useRouter();
  const { setActiveJobId } = useLiveDashboard();
  const [storeId, setStoreId] = useState("STORE_BLR_002");
  const [clipStart, setClipStart] = useState("2026-04-16T08:00:00Z");
  const [sampleFps, setSampleFps] = useState(3);
  const [autoStart, setAutoStart] = useState(true);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [job, setJob] = useState<PipelineJob | null>(null);
  const [status, setStatus] = useState("Select camera videos to create a processing job.");

  function onFiles(files: FileList | null) {
    if (!files) {
      return;
    }
    const next = Array.from(files).map((file) => ({
      file,
      cameraId: cameraIdFromFile(file),
      role: inferRole(file.name),
    }));
    setItems(next);
  }

  async function upload() {
    if (items.length === 0) {
      setStatus("Add at least one video file.");
      return;
    }

    setStatus("Creating processing job...");
    let createResponse: Response;
    try {
      createResponse = await fetch(`${DIRECT_API_BASE_URL}/pipeline/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          clip_start: clipStart,
          sample_fps: sampleFps,
        }),
      });
    } catch {
      setStatus(`Job creation failed. The browser could not reach the API at ${DIRECT_API_BASE_URL}.`);
      return;
    }
    if (!createResponse.ok) {
      const errorText = await createResponse.text().catch(() => "");
      setStatus(`Job creation failed with ${createResponse.status}${errorText ? `: ${errorText}` : ""}`);
      return;
    }

    const nextJob = await createResponse.json() as PipelineJob;
    setJob(nextJob);
    setActiveJobId(nextJob.job_id);
    setStatus("Job created. Redirecting to dashboard and uploading videos...");
    router.push(`/dashboard?job=${encodeURIComponent(nextJob.job_id)}`);

    const form = new FormData();
    form.append("auto_start", String(autoStart));
    form.append(
      "camera_roles",
      JSON.stringify(Object.fromEntries(items.map((item) => [item.cameraId, item.role]))),
    );
    for (const item of items) {
      form.append(item.cameraId, item.file);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${DIRECT_API_BASE_URL}/pipeline/jobs/${encodeURIComponent(nextJob.job_id)}/upload`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setStatus(`Uploading videos: ${Math.round((event.loaded / event.total) * 100)}%`);
      } else {
        setStatus("Uploading videos...");
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setStatus(autoStart ? "Upload complete. Processing started." : "Upload complete. Start the job from the dashboard.");
        return;
      }
      setStatus(`Upload failed with ${xhr.status}${xhr.responseText ? `: ${xhr.responseText}` : ""}`);
    };
    xhr.onerror = () => {
      setStatus(`Upload failed. The browser could not reach the API at ${DIRECT_API_BASE_URL}.`);
    };
    xhr.send(form);
  }

  async function startJob() {
    if (!job) {
      return;
    }
    let response: Response;
    try {
      response = await fetch(`${DIRECT_API_BASE_URL}/pipeline/jobs/${job.job_id}/start`, { method: "POST" });
    } catch {
      setStatus(`Start failed. The browser could not reach the API at ${DIRECT_API_BASE_URL}.`);
      return;
    }
    if (!response.ok) {
      setStatus(`Start failed with ${response.status}`);
      return;
    }
    const nextJob = await response.json() as PipelineJob;
    setJob(nextJob);
    setActiveJobId(nextJob.job_id);
    setStatus("Processing started.");
  }

  return (
    <AppShell>
      <div className="grid gap-8 xl:grid-cols-[0.9fr_1.1fr]">
        <section>
          <h1 className="text-3xl font-bold tracking-tight">Add Video</h1>
          <p className="mt-2 text-slate-600">
            Upload multiple camera-angle clips, assign camera roles, and stream processing results to the dashboard.
          </p>

          <div className="card mt-6 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Store ID</span>
                <input
                  value={storeId}
                  onChange={(event) => setStoreId(event.target.value)}
                  className="focus-ring mt-2 h-11 w-full rounded-lg border border-slate-300 px-3"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Clip start</span>
                <input
                  value={clipStart}
                  onChange={(event) => setClipStart(event.target.value)}
                  className="focus-ring mt-2 h-11 w-full rounded-lg border border-slate-300 px-3"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Sample FPS</span>
                <input
                  type="number"
                  min="1"
                  value={sampleFps}
                  onChange={(event) => setSampleFps(Number(event.target.value))}
                  className="focus-ring mt-2 h-11 w-full rounded-lg border border-slate-300 px-3"
                />
              </label>
              <label className="mt-7 flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(event) => setAutoStart(event.target.checked)}
                  className="h-5 w-5 accent-emerald-600"
                />
                Auto start processing
              </label>
            </div>

            <label className="mt-6 block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <span className="block text-sm font-semibold text-slate-700">Upload camera videos</span>
              <span className="mt-1 block text-sm text-slate-500">Select one or more MP4 files from different camera angles.</span>
              <input
                type="file"
                multiple
                accept="video/*"
                onChange={(event) => onFiles(event.target.files)}
                className="mt-4 block w-full text-sm"
              />
            </label>

            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={upload} className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white">
                Upload Videos
              </button>
              {job && !autoStart ? (
                <button onClick={startJob} className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold">
                  Start Job
                </button>
              ) : null}
            </div>
            <p className="mt-4 text-sm text-slate-600">{status}</p>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-xl font-bold">Camera Files</h2>
          <div className="mt-5 space-y-4">
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">No videos selected yet.</p>
            ) : items.map((item, index) => (
              <div key={`${item.file.name}-${index}`} className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-[1fr_180px]">
                <label>
                  <span className="text-xs font-semibold uppercase text-slate-500">Camera ID</span>
                  <input
                    value={item.cameraId}
                    onChange={(event) => {
                      const next = [...items];
                      next[index] = { ...item, cameraId: event.target.value.toUpperCase() };
                      setItems(next);
                    }}
                    className="focus-ring mt-2 h-10 w-full rounded-lg border border-slate-300 px-3"
                  />
                  <span className="mt-2 block truncate text-xs text-slate-500">{item.file.name}</span>
                </label>
                <label>
                  <span className="text-xs font-semibold uppercase text-slate-500">Role</span>
                  <select
                    value={item.role}
                    onChange={(event) => {
                      const next = [...items];
                      next[index] = { ...item, role: event.target.value as UploadItem["role"] };
                      setItems(next);
                    }}
                    className="focus-ring mt-2 h-10 w-full rounded-lg border border-slate-300 px-3"
                  >
                    <option value="entry">entry</option>
                    <option value="floor">floor</option>
                    <option value="billing">billing</option>
                  </select>
                </label>
              </div>
            ))}
          </div>

          {job ? (
            <div className="mt-6 rounded-lg bg-emerald-50 p-5">
              <p className="text-sm font-semibold text-emerald-800">Created job {job.job_id}</p>
              <p className="mt-1 text-sm text-emerald-700">Status: {job.status}</p>
              <Link href={`/dashboard?job=${job.job_id}`} className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white">
                Open Dashboard
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
