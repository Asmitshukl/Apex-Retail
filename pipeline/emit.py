"""Event construction, JSONL output, and ingest posting helpers."""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

import requests


EVENT_TYPES = {
    "ENTRY",
    "EXIT",
    "ZONE_ENTER",
    "ZONE_EXIT",
    "ZONE_DWELL",
    "BILLING_QUEUE_JOIN",
    "BILLING_QUEUE_ABANDON",
    "REENTRY",
}


def make_event(
    store_id: str,
    camera_id: str,
    visitor_id: str,
    event_type: str,
    timestamp: str,
    zone_id: str | None,
    dwell_ms: int,
    is_staff: bool,
    confidence: float,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """Build and validate a detection event dictionary."""
    if event_type not in EVENT_TYPES:
        raise ValueError(f"Unsupported event_type: {event_type}")

    event = {
        "event_id": str(uuid.uuid4()),
        "store_id": store_id,
        "camera_id": camera_id,
        "visitor_id": visitor_id,
        "event_type": event_type,
        "timestamp": timestamp,
        "zone_id": zone_id,
        "dwell_ms": int(dwell_ms),
        "is_staff": bool(is_staff),
        "confidence": float(confidence),
        "metadata": metadata,
    }
    _validate_event(event)
    return event


def write_event(event: dict[str, Any], output_path: str) -> None:
    """Append one event as a JSON line, creating the output file if needed."""
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    with open(output_path, "a", encoding="utf-8") as output_file:
        output_file.write(json.dumps(event, separators=(",", ":")) + "\n")


def post_events(events: list[dict[str, Any]], api_url: str) -> None:
    """Post events to an ingest API in batches of 100, continuing after failures."""
    if not api_url:
        return

    ingest_url = f"{api_url.rstrip('/')}/events/ingest"
    for start in range(0, len(events), 100):
        batch = events[start : start + 100]
        try:
            response = requests.post(ingest_url, json={"events": batch}, timeout=10)
            if 200 <= response.status_code < 300:
                print(f"Batch accepted: {len(batch)} events")
            else:
                print(f"Batch failed: {response.status_code} {response.reason}")
        except requests.RequestException as exc:
            print(f"Batch failed: request error {exc}")


def _validate_event(event: dict[str, Any]) -> None:
    """Validate that the event contains all required schema fields."""
    required_fields = {
        "event_id",
        "store_id",
        "camera_id",
        "visitor_id",
        "event_type",
        "timestamp",
        "zone_id",
        "dwell_ms",
        "is_staff",
        "confidence",
        "metadata",
    }
    missing_fields = required_fields - event.keys()
    if missing_fields:
        raise ValueError(f"Event missing required fields: {sorted(missing_fields)}")

    metadata = event["metadata"]
    if not isinstance(metadata, dict):
        raise ValueError("Event metadata must be a dict")

    for metadata_field in ("queue_depth", "sku_zone", "session_seq"):
        if metadata_field not in metadata:
            raise ValueError(f"Event metadata missing '{metadata_field}'")

    group_entry = metadata.get("group_entry", False)
    if not isinstance(group_entry, bool):
        raise ValueError("Event metadata 'group_entry' must be a bool")

    group_size = metadata.get("group_size", 1)
    if not isinstance(group_size, int):
        raise ValueError("Event metadata 'group_size' must be an int")

    occluded = metadata.get("occluded", False)
    if not isinstance(occluded, bool):
        raise ValueError("Event metadata 'occluded' must be a bool")

    heartbeat = metadata.get("heartbeat", False)
    if not isinstance(heartbeat, bool):
        raise ValueError("Event metadata 'heartbeat' must be a bool")

    empty_store_duration_s = metadata.get("empty_store_duration_s")
    if empty_store_duration_s is not None and not isinstance(empty_store_duration_s, int):
        raise ValueError("Event metadata 'empty_store_duration_s' must be an int")

    reentry_count = metadata.get("reentry_count", 0)
    if not isinstance(reentry_count, int):
        raise ValueError("Event metadata 'reentry_count' must be an int")
