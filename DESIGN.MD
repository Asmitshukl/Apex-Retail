# DESIGN.md — Store Intelligence System
### Apex Retail · Offline Store Analytics Pipeline

---

## 1. System Overview

This system converts raw anonymised CCTV footage into a live, queryable store analytics API. The pipeline is split into four loosely-coupled stages:

```
Raw CCTV Clips
      │
      ▼
┌─────────────────────┐
│   Detection Layer   │  YOLOv8 + ByteTrack + OSNet Re-ID
│   (pipeline/)       │  Emits structured JSONL events
└─────────────────────┘
      │  JSONL event stream
      ▼
┌─────────────────────┐
│  Intelligence API   │  FastAPI + PostgreSQL (via Prisma / raw asyncpg)
│  (api/)             │  POST /events/ingest → real-time metrics
└─────────────────────┘
      │  REST + WebSocket
      ▼
┌─────────────────────┐
│   Live Dashboard    │  Next.js frontend (apex_fe/)
│   (apex_fe/)        │  Real-time metric tiles + heatmap grid
└─────────────────────┘
```

Everything is containerised. `docker compose up` starts the API, database, and frontend together. The detection pipeline runs separately against local clip files and streams or batch-posts events to the API.

---

## 2. Architecture Diagrams

### 2.1 End-to-End Pipeline Flow

![Pipeline Architecture](https://drive.google.com/uc?export=view&id=1NzVtgssZ1LcnhZMHRush2QfgTBfrSLko)

*Figure 1 — Full data flow from raw CCTV clip through detection, event emission, API ingestion, and dashboard rendering.*

---

### 2.2 Detection Layer — Tracking & Re-ID Design

![Detection Layer Design](https://drive.google.com/uc?export=view&id=1fg4S8QSNLsPcNHC1xIpmip3RIAtgt1c6)

*Figure 2 — Per-frame detection (YOLOv8), multi-object tracking (ByteTrack), Re-ID token assignment (OSNet), and event type classification logic.*

---

### 2.3 API Layer — Ingestion & Metrics Architecture

![API Architecture](https://drive.google.com/uc?export=view&id=1fgczJHgTBulZx4r75I2IdNGA0ylEBLVy)

*Figure 3 — Event ingestion pipeline with deduplication, session reconstruction, metric computation, anomaly detection, and the REST endpoint surface.*

---

