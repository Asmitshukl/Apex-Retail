"use client";

import { useState } from "react";
import { AppShell } from "./AppShell";

export function LiveClient() {
  const [cameraId, setCameraId] = useState("CAM_ENTRY_LIVE_01");
  const [role, setRole] = useState("entry");
  const [streamUrl, setStreamUrl] = useState("rtsp://camera-ip:554/stream1");
  const [storeId, setStoreId] = useState("STORE_BLR_002");
  const [status, setStatus] = useState("Live camera processing will be enabled after uploaded-video processing is validated end to end.");

  return (
    <AppShell>
      <div className="grid gap-8 xl:grid-cols-[0.9fr_1.1fr]">
        <section>
          <h1 className="text-3xl font-bold tracking-tight">Live Camera</h1>
          <p className="mt-2 text-slate-600">
            Register camera access details for future 24/7 CCTV streaming. The page is ready for the live-camera backend phase.
          </p>
          <div className="card mt-6 grid gap-4 p-6">
            <label>
              <span className="text-sm font-semibold text-slate-700">Camera ID</span>
              <input value={cameraId} onChange={(event) => setCameraId(event.target.value)} className="focus-ring mt-2 h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            <label>
              <span className="text-sm font-semibold text-slate-700">Camera role</span>
              <select value={role} onChange={(event) => setRole(event.target.value)} className="focus-ring mt-2 h-11 w-full rounded-lg border border-slate-300 px-3">
                <option value="entry">entry</option>
                <option value="floor">floor</option>
                <option value="billing">billing</option>
              </select>
            </label>
            <label>
              <span className="text-sm font-semibold text-slate-700">Stream URL</span>
              <input value={streamUrl} onChange={(event) => setStreamUrl(event.target.value)} className="focus-ring mt-2 h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            <label>
              <span className="text-sm font-semibold text-slate-700">Store ID</span>
              <input value={storeId} onChange={(event) => setStoreId(event.target.value)} className="focus-ring mt-2 h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            <button
              onClick={() => setStatus(`Saved draft config for ${cameraId}. Backend live-camera processing comes next.`)}
              className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white"
            >
              Save Draft
            </button>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-xl font-bold">Live Readiness</h2>
          <p className="mt-3 text-sm text-slate-600">{status}</p>
          <div className="mt-6 grid gap-4">
            {[
              "RTSP/HLS source registration",
              "Per-camera role and store mapping",
              "Reconnect and offline status handling",
              "SSE dashboard updates reused from upload jobs",
            ].map((item) => (
              <div key={item} className="rounded-lg border border-slate-200 p-4 text-sm font-medium text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
