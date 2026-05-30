"""Detection layer for Apex Retail CCTV analytics."""

from __future__ import annotations

import argparse
import csv
import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO

import emit
import zones
from identity import CrossCameraRegistry
from tracker import ReIDTracker


PERSON_CLASS_ID = 0
PERSON_CONFIDENCE_THRESHOLD = 0.4
TRACKING_THRESHOLD = 0.4
ENTRY_ZONE_NUMBER = "0"
EXIT_TIMEOUT_SECONDS = 5
DWELL_SECONDS = 30
DEFAULT_CLIP_START = "2026-01-01T00:00:00Z"
CROSS_CAMERA_REGISTRY = CrossCameraRegistry()


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for processing a single MP4 clip."""
    parser = argparse.ArgumentParser(description="Run CCTV people detection on one clip.")
    parser.add_argument("--clip", required=True, help="Path to the input .mp4 file")
    parser.add_argument("--store-id", required=True, help="Store ID, e.g. STORE_BLR_002")
    parser.add_argument("--camera-id", required=True, help="Camera ID, e.g. CAM_ENTRY_01")
    parser.add_argument("--layout", required=True, help="Path to store_layout.json")
    parser.add_argument("--output", required=True, help="Path to output .jsonl file")
    parser.add_argument("--api-url", default=None, help="Optional API base URL")
    parser.add_argument(
        "--clip-start",
        default=DEFAULT_CLIP_START,
        help='Clip start time as ISO-8601 UTC, e.g. "2026-03-03T14:00:00Z"',
    )
    parser.add_argument("--pos-file", default=None, help="Optional pos_transactions.csv path")
    parser.add_argument("--sample-fps", type=float, default=1.0, help="Frames per second to sample")
    return parser.parse_args()


def parse_clip_start(clip_start_iso: str) -> datetime:
    """Parse a clip-start ISO-8601 timestamp into a UTC datetime."""
    normalized = clip_start_iso.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def timestamp_from_frame(clip_start_dt: datetime, frame_number: int, fps: float) -> tuple[datetime, str]:
    """Return clip-derived frame time and ISO-8601 UTC timestamp for a frame index."""
    safe_fps = fps if fps > 0 else 1.0
    frame_time = clip_start_dt + timedelta(seconds=frame_number / safe_fps)
    return frame_time, frame_time.isoformat() + "Z"


def make_visitor_id(store_id: str, track_id: int, utc_date_string: str) -> str:
    """Create a stable in-session visitor ID from store, track ID, and UTC date."""
    digest = hashlib.sha256(f"{store_id}{track_id}{utc_date_string}".encode("utf-8"))
    return "VIS_" + digest.hexdigest()[:6]


def is_staff(frame: np.ndarray, bbox: np.ndarray) -> bool:
    """Return whether a person crop is likely staff using green/blue HSV coverage."""
    try:
        x1, y1, x2, y2 = [int(round(value)) for value in bbox]
        height, width = frame.shape[:2]
        x1 = max(0, min(x1, width - 1))
        x2 = max(0, min(x2, width))
        y1 = max(0, min(y1, height - 1))
        y2 = max(0, min(y2, height))
        if x2 <= x1 or y2 <= y1:
            return False

        crop = frame[y1:y2, x1:x2]
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        green_mask = cv2.inRange(hsv, np.array([35, 81, 51]), np.array([85, 255, 255]))
        blue_mask = cv2.inRange(hsv, np.array([100, 81, 51]), np.array([130, 255, 255]))
        combined_mask = cv2.bitwise_or(green_mask, blue_mask)
        coverage = float(np.count_nonzero(combined_mask)) / float(crop.shape[0] * crop.shape[1])
        return coverage > 0.35
    except Exception:
        return False


def run_yolo_person_detections(model: YOLO, frame: np.ndarray) -> sv.Detections:
    """Run YOLOv8 on a frame and return person-only detections for ByteTrack."""
    results = model(frame, classes=[PERSON_CLASS_ID], conf=0.0, device="cpu", verbose=False)
    result = results[0]

    if result.boxes is None or len(result.boxes) == 0:
        return sv.Detections.empty()

    xyxy = result.boxes.xyxy.cpu().numpy()
    confidence = result.boxes.conf.cpu().numpy()
    class_id = result.boxes.cls.cpu().numpy().astype(int)

    # Low confidence events emitted per schema requirement.
    person_mask = class_id == PERSON_CLASS_ID
    return sv.Detections(
        xyxy=xyxy[person_mask],
        confidence=confidence[person_mask],
        class_id=class_id[person_mask],
    )


def create_byte_tracker() -> sv.ByteTrack:
    """Create a ByteTrack instance with the configured tracking threshold."""
    try:
        return sv.ByteTrack(track_activation_threshold=TRACKING_THRESHOLD)
    except TypeError:
        return sv.ByteTrack(track_thresh=TRACKING_THRESHOLD)


def build_metadata(
    zone_name: str | None,
    session_seq: int,
    queue_depth: int | None = None,
) -> dict[str, Any]:
    """Build the metadata object required by the event schema."""
    return {
        "queue_depth": queue_depth,
        "sku_zone": zone_name,
        "session_seq": session_seq,
    }


def emit_detection_event(
    events: list[dict[str, Any]],
    output_path: str,
    store_id: str,
    camera_id: str,
    visitor_id: str,
    event_type: str,
    timestamp: str,
    zone_name: str | None,
    dwell_ms: int,
    staff: bool,
    confidence: float,
    session_seq: int,
    queue_depth: int | None = None,
) -> None:
    """Construct, store, and append one detection event."""
    event = emit.make_event(
        store_id=store_id,
        camera_id=camera_id,
        visitor_id=visitor_id,
        event_type=event_type,
        timestamp=timestamp,
        zone_id=zone_name,
        dwell_ms=dwell_ms,
        is_staff=staff,
        confidence=confidence,
        metadata=build_metadata(zone_name, session_seq, queue_depth),
    )
    emit.write_event(event, output_path)
    events.append(event)


def zone_display_name(zone_number: str | None, zones_dict: dict[str, dict[str, Any]]) -> str | None:
    """Return the display name for a zone number, or None when outside all zones."""
    if zone_number is None:
        return None
    zone_data = zones_dict.get(zone_number)
    if zone_data is None:
        return None
    return str(zone_data.get("name"))


def is_billing_zone(zone_number: str | None, zones_dict: dict[str, dict[str, Any]]) -> bool:
    """Return True if a zone's display name identifies it as a billing zone."""
    zone_name = zone_display_name(zone_number, zones_dict)
    return zone_name is not None and "billing" in zone_name.lower()


def load_pos_transactions(pos_file: str | None) -> list[dict[str, Any]]:
    """Load POS transactions from a CSV file when one is provided.

    Expected columns are flexible, but store_id and timestamp are required for
    correlation. Timestamp values must be ISO-8601 strings, with an optional Z.
    """
    if not pos_file:
        return []

    transactions: list[dict[str, Any]] = []
    with open(pos_file, "r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        for row in reader:
            timestamp_value = row.get("timestamp") or row.get("created_at") or row.get("time")
            store_id = row.get("store_id")
            if not store_id or not timestamp_value:
                continue
            try:
                timestamp = parse_clip_start(timestamp_value)
            except ValueError:
                continue
            transactions.append({"store_id": store_id, "timestamp": timestamp})

    return transactions


def has_recent_pos_transaction(
    pos_transactions: list[dict[str, Any]],
    store_id: str,
    reference_time: datetime,
    window_seconds: int = 300,
) -> bool:
    """Return True if a POS transaction exists for a store in the recent window."""
    window_start = reference_time - timedelta(seconds=window_seconds)
    for transaction in pos_transactions:
        if transaction["store_id"] != store_id:
            continue
        timestamp = transaction["timestamp"]
        if window_start <= timestamp <= reference_time:
            return True
    return False


def process_tracked_person(
    track_id: int,
    bbox: np.ndarray,
    confidence: float,
    frame: np.ndarray,
    frame_timestamp: str,
    frame_time: datetime,
    zones_dict: dict[str, dict[str, Any]],
    track_state: dict[int, dict[str, Any]],
    reid_tracker: ReIDTracker,
    billing_zone_visitors: dict[str, datetime],
    pos_transactions: list[dict[str, Any]],
    events: list[dict[str, Any]],
    args: argparse.Namespace,
) -> None:
    """Update one tracked person's state and emit movement events when needed."""
    x1, y1, x2, y2 = bbox
    centroid_x = (x1 + x2) / 2.0
    centroid_y = (y1 + y2) / 2.0
    frame_h, frame_w = frame.shape[:2]

    zone_number = zones.classify_zone(centroid_x, centroid_y, frame_w, frame_h, zones_dict)
    zone_name = zone_display_name(zone_number, zones_dict)
    utc_date_string = frame_time.date().isoformat()
    staff = is_staff(frame, bbox)

    state = track_state.get(track_id)
    if state is None:
        embedding = reid_tracker.extract_embedding(frame, bbox)
        matched_id = reid_tracker.match(embedding)
        candidate_visitor_id = make_visitor_id(args.store_id, track_id, utc_date_string)
        visitor_id = matched_id or CROSS_CAMERA_REGISTRY.find_or_create(embedding, candidate_visitor_id)
        state = {
            "visitor_id": visitor_id,
            "current_zone": zone_number,
            "zone_enter_time": frame_time,
            "last_seen": frame_time,
            "session_seq": 1,
            "exited": False,
            "dwell_last_emitted": frame_time,
            "last_confidence": confidence,
        }
        track_state[track_id] = state

        if matched_id is not None:
            state["session_seq"] = 1
            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                visitor_id,
                "REENTRY",
                frame_timestamp,
                zone_name,
                0,
                staff,
                confidence,
                state["session_seq"],
            )
            reid_tracker.clear_exit(matched_id)
        else:
            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                visitor_id,
                "ENTRY",
                frame_timestamp,
                None,
                0,
                staff,
                confidence,
                state["session_seq"],
            )

        reid_tracker.register(visitor_id, embedding)
        CROSS_CAMERA_REGISTRY.update(visitor_id, embedding)

        if zone_number is not None and zone_number != ENTRY_ZONE_NUMBER:
            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                visitor_id,
                "ZONE_ENTER",
                frame_timestamp,
                zone_name,
                0,
                staff,
                confidence,
                state["session_seq"],
            )
            if is_billing_zone(zone_number, zones_dict):
                queue_depth = len(billing_zone_visitors)
                if queue_depth > 0:
                    emit_detection_event(
                        events,
                        args.output,
                        args.store_id,
                        args.camera_id,
                        visitor_id,
                        "BILLING_QUEUE_JOIN",
                        frame_timestamp,
                        zone_name,
                        0,
                        staff,
                        confidence,
                        state["session_seq"],
                        queue_depth,
                    )
                billing_zone_visitors[visitor_id] = frame_time
        return

    visitor_id = state["visitor_id"]
    state["last_confidence"] = confidence
    embedding = reid_tracker.extract_embedding(frame, bbox)
    reid_tracker.register(visitor_id, embedding)
    CROSS_CAMERA_REGISTRY.update(visitor_id, embedding)

    if state["exited"]:
        state["session_seq"] += 1
        state["exited"] = False
        state["zone_enter_time"] = frame_time
        state["dwell_last_emitted"] = frame_time
        emit_detection_event(
            events,
            args.output,
            args.store_id,
            args.camera_id,
            visitor_id,
            "REENTRY",
            frame_timestamp,
            zone_name,
            0,
            staff,
            confidence,
            state["session_seq"],
        )

    previous_zone = state["current_zone"]
    if zone_number != previous_zone:
        if previous_zone is not None:
            previous_zone_name = zone_display_name(previous_zone, zones_dict)
            dwell_ms = int((frame_time - state["zone_enter_time"]).total_seconds() * 1000)
            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                visitor_id,
                "ZONE_EXIT",
                frame_timestamp,
                previous_zone_name,
                dwell_ms,
                staff,
                confidence,
                state["session_seq"],
            )

            if is_billing_zone(previous_zone, zones_dict):
                if args.pos_file and not has_recent_pos_transaction(
                    pos_transactions,
                    args.store_id,
                    frame_time,
                ):
                    emit_detection_event(
                        events,
                        args.output,
                        args.store_id,
                        args.camera_id,
                        visitor_id,
                        "BILLING_QUEUE_ABANDON",
                        frame_timestamp,
                        previous_zone_name,
                        dwell_ms,
                        staff,
                        confidence,
                        state["session_seq"],
                        max(len(billing_zone_visitors) - 1, 0),
                    )
                billing_zone_visitors.pop(visitor_id, None)

        if zone_number is not None:
            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                visitor_id,
                "ZONE_ENTER",
                frame_timestamp,
                zone_name,
                0,
                staff,
                confidence,
                state["session_seq"],
            )

            if is_billing_zone(zone_number, zones_dict):
                queue_depth = len(billing_zone_visitors)
                if queue_depth > 0:
                    emit_detection_event(
                        events,
                        args.output,
                        args.store_id,
                        args.camera_id,
                        visitor_id,
                        "BILLING_QUEUE_JOIN",
                        frame_timestamp,
                        zone_name,
                        0,
                        staff,
                        confidence,
                        state["session_seq"],
                        queue_depth,
                    )
                billing_zone_visitors[visitor_id] = frame_time

        state["current_zone"] = zone_number
        state["zone_enter_time"] = frame_time
        state["dwell_last_emitted"] = frame_time
    elif zone_number is not None:
        dwell_elapsed = (frame_time - state["dwell_last_emitted"]).total_seconds()
        if dwell_elapsed >= DWELL_SECONDS:
            dwell_ms = int((frame_time - state["zone_enter_time"]).total_seconds() * 1000)
            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                visitor_id,
                "ZONE_DWELL",
                frame_timestamp,
                zone_name,
                dwell_ms,
                staff,
                confidence,
                state["session_seq"],
            )
            state["dwell_last_emitted"] = frame_time

    state["last_seen"] = frame_time


def emit_timed_out_exits(
    track_state: dict[int, dict[str, Any]],
    reid_tracker: ReIDTracker,
    events: list[dict[str, Any]],
    zones_dict: dict[str, dict[str, Any]],
    args: argparse.Namespace,
    frame_time: datetime,
    frame_timestamp: str,
    active_track_ids: set[int],
) -> None:
    """Emit EXIT events for tracks missing longer than the configured timeout."""
    for track_id, state in track_state.items():
        if track_id in active_track_ids or state["exited"]:
            continue

        missing_seconds = (frame_time - state["last_seen"]).total_seconds()
        if missing_seconds <= EXIT_TIMEOUT_SECONDS:
            continue

        dwell_ms = int((state["last_seen"] - state["zone_enter_time"]).total_seconds() * 1000)
        emit_detection_event(
            events,
            args.output,
            args.store_id,
            args.camera_id,
            state["visitor_id"],
            "EXIT",
            frame_timestamp,
            None,
            max(dwell_ms, 0),
            False,
            float(state.get("last_confidence", 0.0)),
            state["session_seq"],
        )
        reid_tracker.mark_exit(state["visitor_id"], frame_time)

        state["exited"] = True


def flush_open_exits(
    track_state: dict[int, dict[str, Any]],
    reid_tracker: ReIDTracker,
    events: list[dict[str, Any]],
    args: argparse.Namespace,
    frame_time: datetime,
    frame_timestamp: str,
) -> None:
    """Emit EXIT events for all non-exited tracks at end of file."""
    for state in track_state.values():
        if state["exited"]:
            continue
        dwell_ms = int((frame_time - state["zone_enter_time"]).total_seconds() * 1000)
        emit_detection_event(
            events,
            args.output,
            args.store_id,
            args.camera_id,
            state["visitor_id"],
            "EXIT",
            frame_timestamp,
            None,
            max(dwell_ms, 0),
            False,
            float(state.get("last_confidence", 0.0)),
            state["session_seq"],
        )
        reid_tracker.mark_exit(state["visitor_id"], frame_time)
        state["exited"] = True


def process_clip(args: argparse.Namespace) -> list[dict[str, Any]]:
    """Process one MP4 clip and return all emitted events."""
    zones_dict = zones.load_zones(args.layout)
    pos_transactions = load_pos_transactions(args.pos_file)
    cap = cv2.VideoCapture(args.clip)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video clip: {args.clip}")

    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    if os.path.exists(args.output):
        open(args.output, "w", encoding="utf-8").close()

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    safe_video_fps = video_fps if video_fps > 0 else 1.0
    sample_fps = args.sample_fps if args.sample_fps > 0 else 1.0
    sample_every = max(1, int(safe_video_fps / sample_fps))
    clip_start_dt = parse_clip_start(args.clip_start)

    model = YOLO("yolov8n.pt").to("cpu")
    tracker = create_byte_tracker()
    reid_tracker = ReIDTracker()
    track_state: dict[int, dict[str, Any]] = {}
    billing_zone_visitors: dict[str, datetime] = {}
    events: list[dict[str, Any]] = []

    frame_number = 0
    last_frame_time = clip_start_dt
    last_frame_timestamp = clip_start_dt.isoformat() + "Z"
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_number % sample_every != 0:
                frame_number += 1
                continue

            frame_time, frame_timestamp = timestamp_from_frame(
                clip_start_dt,
                frame_number,
                safe_video_fps,
            )
            last_frame_time = frame_time
            last_frame_timestamp = frame_timestamp
            detections = run_yolo_person_detections(model, frame)
            tracked_detections = tracker.update_with_detections(detections)
            active_track_ids: set[int] = set()

            if tracked_detections.tracker_id is not None:
                for bbox, confidence, track_id in zip(
                    tracked_detections.xyxy,
                    tracked_detections.confidence,
                    tracked_detections.tracker_id,
                ):
                    if track_id is None:
                        continue
                    track_id_int = int(track_id)
                    active_track_ids.add(track_id_int)
                    process_tracked_person(
                        track_id_int,
                        bbox,
                        float(confidence),
                        frame,
                        frame_timestamp,
                        frame_time,
                        zones_dict,
                        track_state,
                        reid_tracker,
                        billing_zone_visitors,
                        pos_transactions,
                        events,
                        args,
                    )

            emit_timed_out_exits(
                track_state,
                reid_tracker,
                events,
                zones_dict,
                args,
                frame_time,
                frame_timestamp,
                active_track_ids,
            )

            frame_number += 1
    finally:
        cap.release()

    flush_open_exits(
        track_state,
        reid_tracker,
        events,
        args,
        last_frame_time,
        last_frame_timestamp,
    )

    if args.api_url:
        emit.post_events(events, args.api_url)

    return events


def main() -> None:
    """Run the detection layer from command-line arguments."""
    args = parse_args()
    events = process_clip(args)
    print(f"Wrote {len(events)} events to {args.output}")


if __name__ == "__main__":
    main()
