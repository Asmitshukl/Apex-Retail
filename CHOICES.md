# CHOICES.md — Store Intelligence System
### Apex Retail · Key Engineering Decisions

---

## Decision 1 — Detection Model Selection

### Options Considered

| Model | mAP | Latency (CPU) | Memory | Verdict |
|-------|-----|---------------|--------|---------|
| YOLOv8n | Good | ~30ms/frame | ~150MB | ✅ Chosen |
| YOLOv8m | Better | ~120ms/frame | ~400MB | Too slow |
| YOLOv9 | Better | ~200ms/frame | ~600MB | Too slow |
| RT-DETR | Best | ~400ms/frame | ~800MB | Impractical |
| MediaPipe | Fair | ~15ms/frame | ~80MB | Poor on occlusion |

### What AI Suggested

Claude was asked to evaluate detection model trade-offs for a retail CCTV pipeline running on CPU with no GPU assumption. It confirmed YOLOv8n as the correct starting point for this constraint profile. It noted that RT-DETR and YOLOv9 offer meaningfully better mAP on dense scenes but their CPU inference times would drop frame throughput below the 1 FPS sampling requirement on standard retail hardware. It also flagged MediaPipe as unsuitable because its person detection degrades significantly under partial occlusion — a known condition in the provided footage.

### What I Chose and Why

**YOLOv8n (ultralytics 8.4.x)** with ByteTrack via supervision.

The core constraint is CPU-only inference shared across all camera feeds in a single process. YOLOv8n inference at 1–3 FPS sampling rate runs comfortably within this budget. The COCO pretrained weights already detect persons (class 0) without fine-tuning. The model is loaded once and reused across all frames — not reloaded per clip — keeping memory overhead constant regardless of clip count.

The accuracy trade-off is acceptable because the scoring criteria reward correct event emission and schema compliance over raw detection mAP. A YOLOv8n detection at 0.83 confidence on real footage (observed in testing) is sufficient for ENTRY/EXIT counting and zone classification. Low-confidence detections are emitted rather than suppressed, per schema requirement.

**Why not a VLM for zone classification or staff detection:**
A VLM (GPT-4V, Claude Vision, Gemini) was considered for zone classification and staff detection. Both were rejected for the hot path: per-frame API latency (200ms–2s) would collapse throughput from 3 FPS to under 0.5 FPS, breaking the real-time requirement. Staff detection uses an HSV histogram heuristic instead — green/blue dominant pixels above 35% of the bounding box area are flagged as staff uniform. This runs in under 1ms per detection and is sufficient as a placeholder that can be replaced without changing the event schema.

---

## Decision 2 — Event Schema and visitor_id Design

**Current decision: use hash as fallback, colour histogram as primary match.**

### Options Considered

**visitor_id Option A — Hash-based (store_id + track_id + date)**
Simple, deterministic, zero latency. ByteTrack gives a stable track_id within a clip. Hashing it with store_id and date creates a session-scoped visitor token without any Re-ID model in the hot path.

**visitor_id Option B — OSNet deep Re-ID embeddings**
Accurate cross-camera and cross-session identity. Requires torchreid (~400MB weights), adds 50–100ms CPU inference per detection. Incompatible with the shared-model, CPU-only constraint.

**visitor_id Option C — Colour histogram Re-ID as primary, hash as fallback (chosen)**
Lightweight appearance matching using HSV histograms (96-dimensional, <2ms per detection). No external model weights. Colour histogram match is attempted first — if cosine similarity exceeds threshold, the existing visitor_id is reused. If no match, a new hash-based ID is generated. This gives cross-camera and reentry robustness without OSNet dependency.

### What AI Suggested — and Where I Changed My Design

I initially chose Option A (hash-based only) because it is deterministic and simple for a prototype. ByteTrack already gives a stable track_id within a clip, so hashing it creates a clean session-scoped token.

Claude flagged a real limitation: the same physical person returning on a different date gets a different hash because the date component changes. The same person seen by two cameras on the same day also gets a different hash because their ByteTrack track_ids differ across camera instances. This causes re-entry inflation — a known vendor problem the problem statement explicitly calls out.

**I agreed with Claude's assessment and changed the design.** Colour histogram Re-ID (Option C) is now the primary matching layer. The hash-based ID is only generated when no existing visitor match is found above the similarity threshold. This keeps the system lightweight while reducing identity conflicts across cameras and reentries, without adding a heavy OSNet or VLM dependency.

**Known remaining limitation:** Colour histograms can confuse two people wearing similar clothing. The similarity threshold (0.92) is tuned conservatively to reduce false merges. This is acknowledged and would be replaced by OSNet in a production deployment once GPU inference is available.

### Event Schema Design

**Option A — Flat event per detection:** One record per frame per person. Simple to emit, massive volume, no business meaning. Downstream session reconstruction is expensive and lossy.

**Option B — State-machine events (chosen):** Detection layer maintains per-track state and emits semantic events: ENTRY, EXIT, ZONE_ENTER, ZONE_EXIT, ZONE_DWELL, BILLING_QUEUE_JOIN, BILLING_QUEUE_ABANDON, REENTRY. Each event carries business meaning and maps directly to a dashboard metric.

**Option C — Aggregated session summaries:** One record per visitor session. Simple for the API but loses the timeline — impossible to reconstruct queue buildup or zone transition sequences after the fact.

Claude recommended Option B and warned against Option C specifically because anomaly detection (queue spike, conversion drop, dead zone) requires event-level granularity. It also suggested the REENTRY event type to avoid double-counting visitors in the funnel. I agreed on both counts.

**Timestamp design:** timestamps are derived from `clip_start + (frame_number / fps)` not `datetime.utcnow()`. This ensures events are anchored to actual recording time — critical for POS correlation which matches visitors in the billing zone within a 5-minute window before a transaction timestamp.

---

## Decision 3 — API Architecture: Node.js/TypeScript over FastAPI

### Options Considered

**Option A — FastAPI (Python)**
Recommended by the problem statement. Same language as the detection pipeline. Pydantic schema validation. Native async. Scoring harness has best coverage for FastAPI.

**Option B — Node.js + TypeScript + Express (chosen)**
Separate language from the pipeline. Strong TypeScript typing for the event schema. Prisma ORM for PostgreSQL with type-safe queries. Production-grade ecosystem for REST APIs.

### What AI Suggested

Claude explicitly flagged that the problem statement recommends FastAPI and that the scoring harness has best coverage for it. It recommended switching the API to FastAPI to reduce scoring risk. I acknowledged the trade-off and kept Node.js.

### What I Chose and Why

**Node.js + TypeScript.** Two reasons:

**1. Fluency and speed of execution.** I am significantly more fluent in TypeScript than Python for building REST APIs. In a time-constrained challenge, building in the language I know best means fewer bugs, faster iteration, and code I can fully explain and defend in follow-up questions. A FastAPI implementation I'm less comfortable with would produce code I can't reason about under questioning.

**2. TypeScript type safety on the event schema.** The event schema has 11 required fields with specific types and constraints. Zod validation in TypeScript gives compile-time and runtime schema enforcement with precise error messages per field. This maps directly to the partial success requirement on POST /events/ingest — valid events are accepted, invalid ones are rejected with field-level error detail, in a single pass. Prisma adds a second layer of type safety at the database query level.

**The real trade-off acknowledged:** If the automated scoring harness makes FastAPI-specific assumptions about response formats or error structures, that is a scoring risk I accepted knowingly. The API endpoints return standard JSON regardless of framework. The separation of Python pipeline and Node.js API also enforces a clean boundary — the pipeline and API share only the JSONL schema and the POST /events/ingest contract, making either half independently replaceable.

---
## Decision 5 — Staff Detection Model Evolution: HSV → LICM
 
This decision was made after testing on real footage and is the most significant design change during development.
 
### What Was Originally Built
 
The first staff detection used an HSV colour heuristic. The lower 60% of each person bounding box was analysed. If more than 45% of pixels were dark/black (V < 60 in HSV), the person was flagged as staff. This was the initial approach agreed with AI — fast, no training data needed, reasonable assumption since staff wear black uniforms.
 
### What Failed in Real Testing
 
Two failure modes appeared when running against actual Brigade Road clips:
 
**False positives:** Customers wearing dark clothing triggered the 45% threshold and were classified as staff. A customer in a black jacket is visually identical to a staff member at the HSV histogram level.
 
**False negatives:** Staff standing under bright store lighting had elevated brightness values in HSV. The bright light washed out the black, pushing pixels above the dark threshold — staff were classified as customers.
 
These are not tuning problems. No threshold value fixes both failure modes simultaneously.
 
### Options Considered
 
| Option | Accuracy | Training needed | Latency | Verdict |
|--------|----------|----------------|---------|---------|
| HSV heuristic (v1) | ~60% | None | <1ms | ❌ Failed in testing |
| Fine-tune full YOLOv8 | ~95% | Large dataset | ~50ms | Too slow, too heavy |
| VLM per-frame | ~95% | None | 200ms+ | Breaks real-time |
| LICM on Roboflow (chosen) | ~90%+ | ~300 labelled crops | ~5ms | ✅ Chosen |
 
### What AI Suggested
 
Claude recommended a lightweight image classifier (MobileNetV2 or EfficientNet-B0) trained on labelled crops from the actual store footage via Roboflow. Key reasoning: a separate 2-class classifier on already-detected bounding boxes is faster to train and iterate on than fine-tuning YOLOv8, and only runs on 1-5 crops per frame adding ~5ms overhead.
 
### What I Chose and Why
 
**LICM (Lightweight Image Classification Model) trained on Roboflow.**
 
The training flow:
1. Extract person crops from store CCTV clips using YOLOv8 detections
2. Upload crops to Roboflow — label each as `staff` or `customer`
3. Train EfficientNet-B0 on Roboflow (2-class, ~300 labelled examples)
4. Export as ONNX for CPU inference
5. Replace is_staff() HSV function with ONNX inference call in detect.py
6. Both YOLOv8n and LICM loaded once, shared across all camera feeds
**Why not fine-tune YOLOv8 directly:** Adding a `staff` class to YOLOv8 requires retraining the full detection head on a large dataset. A separate lightweight classifier on cropped regions trains faster, is easier to iterate on, and does not risk degrading person detection accuracy.
 
**Why I agreed with AI this time:** The testing evidence was clear. The HSV approach produced visibly wrong results on real footage — customers flagged as staff, staff missed under bright lighting. The LICM approach directly addresses both failure modes by learning the actual visual signature of the uniform from labelled examples.
 
**Current status:** LICM training in progress on Roboflow. The HSV fallback remains in place until the trained ONNX model is integrated. This is documented as a known limitation in the current submission.
 
---
 