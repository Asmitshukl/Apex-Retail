FROM node:20-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    REPO_ROOT=/app \
    PIPELINE_PYTHON=/app/pipeline/.venv/bin/python3 \
    PIPELINE_OUTPUT_DIR=/app/pipeline/output \
    PIPELINE_UPLOADS_DIR=/app/api/uploads/jobs \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-venv \
      python3-pip \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY api/package*.json ./api/
WORKDIR /app/api
RUN npm ci --include=dev

WORKDIR /app
COPY pipeline/requirements.txt ./pipeline/requirements.txt
RUN python3 -m venv /app/pipeline/.venv \
    && /app/pipeline/.venv/bin/pip install --no-cache-dir --upgrade pip \
    && /app/pipeline/.venv/bin/pip install --no-cache-dir -r /app/pipeline/requirements.txt

COPY api ./api
COPY pipeline ./pipeline

RUN mkdir -p /app/api/uploads/jobs /app/pipeline/output \
    && if [ -f /app/pipeline/models/yolov8n.pt ]; then ln -sf /app/pipeline/models/yolov8n.pt /app/yolov8n.pt; fi

WORKDIR /app/api
RUN npx prisma generate
RUN npm run build
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
