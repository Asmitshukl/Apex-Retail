#!/bin/bash
set -e

CLIPS_DIR=${1:-./pipeline/data/clips}
LAYOUT=${2:-./pipeline/data/store_layout.json}
API_URL=${3:-http://localhost:8000}
OUTPUT_DIR=./pipeline/output

mkdir -p "$OUTPUT_DIR"

for clip in "$CLIPS_DIR"/*.mp4; do
  filename=$(basename "$clip" .mp4)
  # expects filename format: STORE_BLR_002_CAM_ENTRY_01.mp4
  store_id=$(echo "$filename" | grep -oP '^STORE_[A-Z]+_\d+')
  camera_id=$(echo "$filename" | grep -oP 'CAM_\w+$')

  echo "Processing $filename -> store=$store_id camera=$camera_id"
  python pipeline/detect.py \
    --clip "$clip" \
    --store-id "$store_id" \
    --camera-id "$camera_id" \
    --layout "$LAYOUT" \
    --output "$OUTPUT_DIR/${filename}.jsonl" \
    --api-url "$API_URL"
done

echo "All clips processed. Events in $OUTPUT_DIR"
