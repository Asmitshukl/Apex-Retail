# Store Intelligence

Offline retail analytics system for CCTV clips. The system processes uploaded multi-camera footage, detects visitors/staff, emits events, stores them in PostgreSQL, and streams live dashboard updates to the frontend.

## Architecture

```text
Frontend upload
  -> API stores videos in a Docker volume
  -> API starts the Python pipeline
  -> YOLOv8 + LICM process each camera clip
  -> JSONL events are ingested in batches
  -> PostgreSQL stores events
  -> SSE updates the dashboard in real time
```

Main services:

- `apex_fe/`: Next.js dashboard
- `api/`: Node.js/TypeScript API
- `pipeline/`: Python video detection pipeline
- `pipeline/models/`: YOLO and LICM model files
- `db`: PostgreSQL container for local Docker testing


## Model Files

The pipeline needs these model files:

```text
pipeline/models/yolov8n.pt
pipeline/models/staff_classifier.onnx
pipeline/models/staff_classifier.onnx.data
pipeline/models/classes.txt
```

There are two supported ways to provide them.

## Fresh Clone Setup

Clone the repository first:

```bash
git clone git@github.com:Asmitshukl/Apex-Retail.git
cd Apex-Retail
```

Then choose one of the two startup methods below.

## Method 1: Git LFS Local Models

Use this when Git LFS is installed and you want the models checked out into `pipeline/models/`.

```bash
git lfs install
git lfs pull
docker-compose up --build
```

This uses the default `docker-compose.yml`.

What this method does:

```text
git lfs pull
  -> downloads the real model files into pipeline/models/

docker-compose up --build
  -> starts PostgreSQL
  -> builds the API image with Node + Python pipeline
  -> builds the frontend image
  -> bind mounts ./pipeline/models into the API container
  -> API loads YOLO + LICM from /app/pipeline/models
```

Model flow:

```text
./pipeline/models
  -> bind mounted into API container
  -> /app/pipeline/models
```

Open:

```text
Frontend: http://localhost:3000
API:      http://localhost:3001
Health:   http://localhost:3001/health
DB host:  localhost:5433
```
Quick API checks:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/metrics
curl http://localhost:3001/stores/STORE_BLR_002/funnel
curl http://localhost:3001/pipeline/status
```

Run API tests:

```bash
cd api
npm test
```


## Method 2: Docker Hub Model Image

Use this when Git LFS is not available on the machine. The model files are pulled as a Docker image.

Current pushed image:

```text
asmitshukl/apex-retail-models:v1
```

Start with:

```bash
MODEL_IMAGE=asmitshukl/apex-retail-models:v1 \
docker-compose -f docker-compose.yml -f docker-compose.models-pull.yml up --build
```

What this method does:

```text
MODEL_IMAGE=asmitshukl/apex-retail-models:v1
  -> tells Compose which Docker Hub image contains the model files

docker-compose -f docker-compose.yml -f docker-compose.models-pull.yml up --build
  -> starts PostgreSQL
  -> pulls/uses the model image
  -> runs model-init once
  -> model-init copies model files into the model_files Docker volume
  -> builds the API image with Node + Python pipeline
  -> builds the frontend image
  -> API mounts model_files at /app/pipeline/models
  -> API loads YOLO + LICM from /app/pipeline/models
```

Model flow:

```text
Docker Hub image
  -> model-init container
  -> model_files Docker volume
  -> API container /app/pipeline/models
```

The `model-init` container exits after copying model files into the shared volume. The API waits for that step before starting.

## Build And Push A New Model Image

If model files change, rebuild and push a new image:

```bash
docker build -f pipeline/models.Dockerfile -t apex-retail-models:local .
docker tag apex-retail-models:local asmitshukl/apex-retail-models:v1
docker push asmitshukl/apex-retail-models:v1
```

Then start with the Docker Hub model image method above.

## Local Model Image Without Pushing

To test the model-image path locally:

```bash
docker build -f pipeline/models.Dockerfile -t apex-retail-models:local .
docker-compose -f docker-compose.yml -f docker-compose.models.yml up --build
```

## Produces Events

The detection pipeline turns CCTV clips into structured JSONL events. Each output line is one event that can be posted to the API ingest path.

Run a single clip manually:

```bash
python3 pipeline/detect.py \
  --clip "pipeline/data/clips/CCTV Footage/CAM_ENTRY_01.mp4" \
  --store-id STORE_BLR_002 \
  --camera-id CAM_ENTRY_01 \
  --camera-role entry \
  --layout pipeline/data/store_layout.json \
  --output pipeline/output/CAM_ENTRY_01.jsonl \
  --clip-start "2026-04-16T08:00:00Z" \
  --sample-fps 3 \
  --live-mode
```

Output goes to:

```text
pipeline/output/CAM_ENTRY_01.jsonl
```

In Docker, that path is backed by the `pipeline_output` volume:

```text
pipeline_output -> /app/pipeline/output
```

To ingest existing JSONL output into the API:

```bash
curl -X POST http://localhost:3001/pipeline/ingest-existing
```

Current frontend flow:

```text
User opens Add Video
  -> frontend creates a job immediately
  -> dashboard opens with /dashboard?job=<job_id>
  -> browser uploads full video files to the API
  -> API stores videos locally on the machine running the API
  -> after upload completes, API starts detect.py for each camera
  -> detect.py writes JSONL output while processing
  -> API tails new JSONL events and ingests them in batches
  -> API broadcasts upload, batch, metrics, and completion updates over SSE
  -> dashboard graphs and summary logs update while processing continues
```

Local development stores uploaded videos under:

```text
api/uploads/jobs/<job_id>/videos
```

EC2 deployment stores them on the EC2 instance or, in Docker, in the `api_uploads` volume:

```text
api_uploads -> /app/api/uploads/jobs
```

The current system streams analytics during processing, not while bytes are still arriving. The upload must complete first because normal MP4 files are not reliably readable while partially uploaded. The improved UX creates the job first and shows upload progress immediately, then switches to live processing updates once the complete files are available.

Recommended production storage model:

```text
Browser upload
  -> API streams multipart upload to local job storage
  -> API processes local files for fastest disk access
  -> background archival uploads original clips and JSONL outputs to S3
  -> API removes local videos after job completion or retention timeout
  -> PostgreSQL remains the source of truth for analytics events
```

This keeps processing fast because the model reads from local disk, while S3 provides durable storage for later audit, replay, or model retraining. The local upload directory should be treated as temporary working storage, not permanent archive storage.

Future live-camera mode:

```text
RTSP/HLS/live feed
  -> API registers a long-running camera job
  -> pipeline reads frames continuously instead of a finite MP4
  -> detect.py runs with --live-mode
  -> API ingests small event batches frequently
  -> SSE keeps dashboard metrics live
  -> local storage is only used for optional short rolling buffers or debug clips
```

For true "process while upload is still happening" with uploaded files, the next design step is chunked/segmented video upload. The frontend would upload small playable segments, and the backend would process completed segments while later segments are still uploading. That requires preserving tracker/Re-ID state across segments so visitor IDs and ENTRY/EXIT logic do not reset between chunks.

## Uploaded Video Storage

Uploaded videos are stored in a named Docker volume:

```text
api_uploads -> /app/api/uploads/jobs
```

Pipeline output is stored in:

```text
pipeline_output -> /app/pipeline/output
```

PostgreSQL data is stored in:

```text
postgres_data -> /var/lib/postgresql/data

```

## Notes

- Local PostgreSQL inside Docker is exposed on host port `5433` to avoid conflicts with a local Postgres running on `5432`.
- The API still connects to the DB inside Docker at `db:5432`.
- The default Docker flow still works and was not replaced by the model-image flow.
- The Docker Hub model-image flow exists only as an optional alternative for machines without Git LFS.
