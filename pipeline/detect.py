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
NO_DETECTION_WARNING_FRAMES = 10
ADAPTIVE_CONFIDENCE_STEP = 0.05
ENTRY_EXIT_CROSSING_PERCENT = 5.0
HEARTBEAT_INTERVAL_SECONDS = 60
DEFAULT_CLIP_START = "2026-01-01T00:00:00Z"
CROSS_CAMERA_REGISTRY = CrossCameraRegistry()
REENTRY_COUNTS: dict[str, int] = {}
VISITOR_SESSION_SEQS: dict[str, int] = {}


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
    parser.add_argument("--min-confidence", type=float, default=0.0, help="Minimum YOLO confidence")
    parser.add_argument(
        "--camera-role",
        choices=("entry", "floor", "billing"),
        default="floor",
        help="Camera role controlling which business events are emitted",
    )
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
    """
    Detect staff by black uniform.
    Staff at this store wear all-black clothing.
    Returns True if the LOWER 60% of the person bbox
    (torso/clothing region, excluding face) has dominant
    dark/black pixels.
    """
    try:
        x1, y1, x2, y2 = map(int, bbox)
        h = y2 - y1
        clothing_y1 = y1 + int(h * 0.4)
        crop = frame[clothing_y1:y2, x1:x2]
        if crop.size == 0:
            return False
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        # Staff wear all-black uniforms. Dark pixel ratio > 45% in
        # clothing region (lower 60% of bbox) flags as staff.
        # Threshold tuned for Brigade Road store footage.
        dark_mask = cv2.inRange(hsv, (0, 0, 0), (180, 255, 60))
        ratio = cv2.countNonZero(dark_mask) / (crop.shape[0] * crop.shape[1])
        return ratio > 0.45
    except Exception:
        return False


def run_yolo_person_detections(
    model: YOLO,
    frame: np.ndarray,
    min_confidence: float,
) -> sv.Detections:
    """Run YOLOv8 on a frame and return person-only detections for ByteTrack."""
    results = model(frame, classes=[PERSON_CLASS_ID], conf=min_confidence, device="cpu", verbose=False)
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
    confidence: float = 1.0,
    metadata_updates: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the metadata object required by the event schema."""
    metadata = {
        "queue_depth": queue_depth,
        "sku_zone": zone_name,
        "session_seq": session_seq,
        "group_entry": False,
        "group_size": 1,
        "occluded": confidence < 0.5,
        "heartbeat": False,
        "reentry_count": 0,
    }
    if metadata_updates:
        metadata.update(metadata_updates)
    return metadata


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
    metadata_updates: dict[str, Any] | None = None,
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
        metadata=build_metadata(
            zone_name,
            session_seq,
            queue_depth,
            confidence,
            metadata_updates,
        ),
    )
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


def can_emit_entry_exit(args: argparse.Namespace) -> bool:
    """Return True when this camera role is allowed to emit ENTRY and EXIT."""
    return args.camera_role == "entry"


def effective_min_confidence(args: argparse.Namespace) -> float:
    """Return the role-aware YOLO confidence threshold."""
    if args.camera_role == "billing" and args.min_confidence == 0.0:
        return 0.25
    return max(args.min_confidence, 0.0)


def adaptive_confidence_floor(args: argparse.Namespace) -> float:
    """Return the lowest confidence threshold adaptive detection may use."""
    return max(args.min_confidence, 0.0)


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


def entry_direction(centroid_history: list[tuple[float, int]]) -> str | None:
    """Return ENTRY/EXIT when the last centroid samples cross the entry line."""
    if len(centroid_history) < 3:
        return None

    recent_x = [point[0] for point in centroid_history[-3:]]
    was_left = min(recent_x[:2]) < ENTRY_EXIT_CROSSING_PERCENT
    was_right = max(recent_x[:2]) > ENTRY_EXIT_CROSSING_PERCENT
    now_right = recent_x[-1] > ENTRY_EXIT_CROSSING_PERCENT
    now_left = recent_x[-1] < ENTRY_EXIT_CROSSING_PERCENT

    if recent_x[0] < recent_x[1] < recent_x[2] and was_left and now_right:
        return "ENTRY"
    if recent_x[0] > recent_x[1] > recent_x[2] and was_right and now_left:
        return "EXIT"
    return None


def finalize_frame_entry_metadata(events: list[dict[str, Any]], frame_start_index: int) -> None:
    """Annotate ENTRY events emitted in the same sampled frame with group metadata."""
    frame_events = events[frame_start_index:]
    entry_events = [event for event in frame_events if event["event_type"] == "ENTRY"]
    group_size = len(entry_events)
    for event in entry_events:
        event["metadata"]["group_entry"] = group_size >= 2
        event["metadata"]["group_size"] = group_size if group_size else 1


def emit_empty_store_heartbeat(
    events: list[dict[str, Any]],
    args: argparse.Namespace,
    frame_timestamp: str,
    empty_store_duration_s: int,
) -> None:
    """Emit a heartbeat event during long zero-detection periods."""
    emit_detection_event(
        events,
        args.output,
        args.store_id,
        args.camera_id,
        "STORE_HEARTBEAT",
        "ZONE_DWELL",
        frame_timestamp,
        None,
        HEARTBEAT_INTERVAL_SECONDS * 1000,
        False,
        1.0,
        0,
        metadata_updates={
            "heartbeat": True,
            "empty_store_duration_s": empty_store_duration_s,
            "occluded": False,
        },
    )


def process_tracked_person(
    track_id: int,
    bbox: np.ndarray,
    confidence: float,
    frame: np.ndarray,
    frame_timestamp: str,
    frame_time: datetime,
    frame_number: int,
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
    x_percent = (centroid_x / frame_w) * 100.0 if frame_w > 0 else 0.0

    zone_number = zones.classify_zone(centroid_x, centroid_y, frame_w, frame_h, zones_dict)
    zone_name = zone_display_name(zone_number, zones_dict)
    utc_date_string = frame_time.date().isoformat()
    detected_staff = is_staff(frame, bbox)

    state = track_state.get(track_id)
    if state is None:
        embedding = reid_tracker.extract_embedding(frame, bbox)
        matched_id = reid_tracker.match(embedding, frame_time)
        matched_reentry = (
            matched_id is not None
            and reid_tracker.check_reentry(matched_id, reference_time=frame_time)
        )
        candidate_visitor_id = make_visitor_id(args.store_id, track_id, utc_date_string)
        visitor_id = matched_id or CROSS_CAMERA_REGISTRY.find_or_create(
            embedding,
            candidate_visitor_id,
            frame_time,
        )
        session_seq = VISITOR_SESSION_SEQS.get(visitor_id, 1)
        if matched_reentry:
            session_seq = VISITOR_SESSION_SEQS.get(visitor_id, 0) + 1
            VISITOR_SESSION_SEQS[visitor_id] = session_seq
            REENTRY_COUNTS[visitor_id] = REENTRY_COUNTS.get(visitor_id, 0) + 1
        else:
            VISITOR_SESSION_SEQS.setdefault(visitor_id, session_seq)

        state = {
            "visitor_id": visitor_id,
            "current_zone": zone_number,
            "zone_enter_time": frame_time,
            "last_seen": frame_time,
            "session_seq": session_seq,
            "exited": False,
            "dwell_last_emitted": frame_time,
            "last_confidence": confidence,
            "is_staff": detected_staff,
            "centroid_history": [(x_percent, frame_number)],
            "entry_emitted": False,
            "exit_emitted": False,
        }
        track_state[track_id] = state
        staff = state["is_staff"]

        if matched_reentry and can_emit_entry_exit(args):
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
                metadata_updates={"reentry_count": REENTRY_COUNTS[visitor_id]},
            )
            reid_tracker.clear_exit(matched_id)
            state["entry_emitted"] = True
        elif can_emit_entry_exit(args) and zone_number == ENTRY_ZONE_NUMBER:
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
            state["entry_emitted"] = True

        reid_tracker.register(visitor_id, embedding)
        CROSS_CAMERA_REGISTRY.update(visitor_id, embedding, frame_time)

        if zone_number is not None and (
            zone_number != ENTRY_ZONE_NUMBER or not can_emit_entry_exit(args)
        ):
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
                if not staff:
                    billing_zone_visitors[visitor_id] = frame_time
        return

    visitor_id = state["visitor_id"]
    staff = bool(state["is_staff"])
    state["last_confidence"] = confidence
    state["centroid_history"].append((x_percent, frame_number))
    embedding = reid_tracker.extract_embedding(frame, bbox)
    reid_tracker.register(visitor_id, embedding)
    CROSS_CAMERA_REGISTRY.update(visitor_id, embedding, frame_time)

    if can_emit_entry_exit(args) and zone_number == ENTRY_ZONE_NUMBER:
        direction = entry_direction(state["centroid_history"])
        if direction == "ENTRY" and (not state["entry_emitted"] or state["exited"]):
            event_type = "ENTRY"
            metadata_updates = None
            if state["exited"]:
                state["session_seq"] += 1
                VISITOR_SESSION_SEQS[visitor_id] = state["session_seq"]
                REENTRY_COUNTS[visitor_id] = REENTRY_COUNTS.get(visitor_id, 0) + 1
                state["exited"] = False
                state["exit_emitted"] = False
                event_type = "REENTRY"
                metadata_updates = {"reentry_count": REENTRY_COUNTS[visitor_id]}
            state["zone_enter_time"] = frame_time
            state["dwell_last_emitted"] = frame_time
            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                visitor_id,
                event_type,
                frame_timestamp,
                None,
                0,
                staff,
                confidence,
                state["session_seq"],
                metadata_updates=metadata_updates,
            )
            state["entry_emitted"] = True
        elif direction == "EXIT" and not state["exit_emitted"]:
            dwell_ms = int((frame_time - state["zone_enter_time"]).total_seconds() * 1000)
            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                visitor_id,
                "EXIT",
                frame_timestamp,
                None,
                max(dwell_ms, 0),
                staff,
                confidence,
                state["session_seq"],
            )
            reid_tracker.mark_exit(visitor_id, frame_time)
            VISITOR_SESSION_SEQS[visitor_id] = state["session_seq"]
            state["exited"] = True
            state["entry_emitted"] = False
            state["exit_emitted"] = True

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
                if not staff:
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
    """Direction-based entry cameras do not emit timeout-only EXIT events."""
    return


def flush_open_exits(
    track_state: dict[int, dict[str, Any]],
    reid_tracker: ReIDTracker,
    events: list[dict[str, Any]],
    args: argparse.Namespace,
    frame_time: datetime,
    frame_timestamp: str,
) -> None:
    """Direction-based entry cameras do not emit end-of-file EXIT events."""
    return


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
    min_confidence = effective_min_confidence(args)
    confidence_floor = adaptive_confidence_floor(args)

    model = YOLO("yolov8n.pt").to("cpu")
    tracker = create_byte_tracker()
    reid_tracker = ReIDTracker()
    track_state: dict[int, dict[str, Any]] = {}
    billing_zone_visitors: dict[str, datetime] = {}
    events: list[dict[str, Any]] = []

    frame_number = 0
    last_frame_time = clip_start_dt
    last_frame_timestamp = clip_start_dt.isoformat() + "Z"
    no_detection_frames = 0
    empty_store_start_time: datetime | None = None
    next_empty_heartbeat_s = HEARTBEAT_INTERVAL_SECONDS
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
            frame_event_start = len(events)
            detections = run_yolo_person_detections(model, frame, min_confidence)
            if len(detections) == 0:
                if empty_store_start_time is None:
                    empty_store_start_time = frame_time
                    next_empty_heartbeat_s = HEARTBEAT_INTERVAL_SECONDS
                empty_duration_s = int((frame_time - empty_store_start_time).total_seconds())
                while empty_duration_s >= next_empty_heartbeat_s:
                    emit_empty_store_heartbeat(
                        events,
                        args,
                        frame_timestamp,
                        next_empty_heartbeat_s,
                    )
                    next_empty_heartbeat_s += HEARTBEAT_INTERVAL_SECONDS

                no_detection_frames += 1
                if no_detection_frames >= NO_DETECTION_WARNING_FRAMES:
                    print(
                        f"WARNING: No detections in last 10 frames on {args.camera_id}. "
                        "Check zone polygons and camera angle."
                    )
                    if min_confidence > confidence_floor:
                        min_confidence = max(
                            confidence_floor,
                            min_confidence - ADAPTIVE_CONFIDENCE_STEP,
                        )
                    no_detection_frames = 0
            else:
                no_detection_frames = 0
                empty_store_start_time = None
                next_empty_heartbeat_s = HEARTBEAT_INTERVAL_SECONDS

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
                        frame_number,
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
            finalize_frame_entry_metadata(events, frame_event_start)

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

    for event in events:
        emit.write_event(event, args.output)

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
