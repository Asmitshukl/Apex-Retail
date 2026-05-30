#!/bin/bash
set -e
CLIPS_DIR=${1:-./pipeline/data/clips/CCTV\ Footage}
LAYOUT=${2:-./pipeline/data/store_layout.json}
POS_FILE=${3:-./pipeline/data/pos_transactions.csv}
API_URL=${4:-http://localhost:3001}
OUTPUT_DIR=./pipeline/output
CLIP_START=${5:-2026-04-16T08:00:00Z}

mkdir -p "$OUTPUT_DIR"

echo "Processing Brigade Road store — 5 cameras"

python3 pipeline/detect.py \
  --clip "$CLIPS_DIR/CAM_ENTRY_01.mp4" \
  --store-id STORE_BLR_002 \
  --camera-id CAM_ENTRY_01 \
  --camera-role entry \
  --layout "$LAYOUT" \
  --output "$OUTPUT_DIR/CAM_ENTRY_01.jsonl" \
  --clip-start "$CLIP_START" \
  --pos-file "$POS_FILE" \
  --sample-fps 3

python3 pipeline/detect.py \
  --clip "$CLIPS_DIR/CAM_FLOOR_01.mp4" \
  --store-id STORE_BLR_002 \
  --camera-id CAM_FLOOR_01 \
  --camera-role floor \
  --layout "$LAYOUT" \
  --output "$OUTPUT_DIR/CAM_FLOOR_01.jsonl" \
  --clip-start "$CLIP_START" \
  --pos-file "$POS_FILE" \
  --sample-fps 3

python3 pipeline/detect.py \
  --clip "$CLIPS_DIR/CAM_FLOOR_02.mp4" \
  --store-id STORE_BLR_002 \
  --camera-id CAM_FLOOR_02 \
  --camera-role floor \
  --layout "$LAYOUT" \
  --output "$OUTPUT_DIR/CAM_FLOOR_02.jsonl" \
  --clip-start "$CLIP_START" \
  --pos-file "$POS_FILE" \
  --sample-fps 3

python3 pipeline/detect.py \
  --clip "$CLIPS_DIR/CAM_FLOOR_03.mp4" \
  --store-id STORE_BLR_002 \
  --camera-id CAM_FLOOR_03 \
  --camera-role floor \
  --layout "$LAYOUT" \
  --output "$OUTPUT_DIR/CAM_FLOOR_03.jsonl" \
  --clip-start "$CLIP_START" \
  --pos-file "$POS_FILE" \
  --sample-fps 3

python3 pipeline/detect.py \
  --clip "$CLIPS_DIR/CAM_BILLING_01.mp4" \
  --store-id STORE_BLR_002 \
  --camera-id CAM_BILLING_01 \
  --camera-role billing \
  --layout "$LAYOUT" \
  --output "$OUTPUT_DIR/CAM_BILLING_01.jsonl" \
  --clip-start "2026-04-16T08:14:00Z" \
  --pos-file "$POS_FILE" \
  --sample-fps 1 \
  --min-confidence 0.15

echo "All cameras processed."
echo "Posting events to API..."

for jsonl in "$OUTPUT_DIR"/*.jsonl; do
  python3 -c "
import json, requests, sys
events = [json.loads(l) for l in open('$jsonl')]
if not events:
    print(f'Skipping empty file: $jsonl')
    sys.exit(0)
batches = [events[i:i+500] for i in range(0, len(events), 500)]
for i, batch in enumerate(batches):
    r = requests.post('${API_URL}/events/ingest',
        json={'events': batch},
        timeout=30)
    print(f'$jsonl batch {i+1}: {r.status_code} — {r.json()}')
  "
done

echo "Done. Events ingested."
