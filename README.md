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
