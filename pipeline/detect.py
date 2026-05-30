"""Detection layer for Apex Retail CCTV analytics."""

from __future__ import annotations

import argparse
import hashlib
import os
from datetime import datetime
from typing import Any

import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO

import emit
import zones
from tracker import ReIDTracker


PERSON_CLASS_ID = 0
PERSON_CONFIDENCE_THRESHOLD = 0.4
ENTRY_ZONE_NUMBER = "0"
EXIT_TIMEOUT_SECONDS = 5
DWELL_SECONDS = 30


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for processing a single MP4 clip."""
    parser = argparse.ArgumentParser(description="Run CCTV people detection on one clip.")
    parser.add_argument("--clip", required=True, help="Path to the input .mp4 file")
    parser.add_argument("--store-id", required=True, help="Store ID, e.g. STORE_BLR_002")
    parser.add_argument("--camera-id", required=True, help="Camera ID, e.g. CAM_ENTRY_01")
    parser.add_argument("--layout", required=True, help="Path to store_layout.json")
    parser.add_argument("--output", required=True, help="Path to output .jsonl file")
    parser.add_argument("--api-url", default=None, help="Optional API base URL")
    return parser.parse_args()


def utc_now() -> datetime:
    """Return the current UTC datetime without timezone information."""
    return datetime.utcnow()


def timestamp_now_iso() -> str:
    """Return the current UTC timestamp in ISO-8601 format with a Z suffix."""
    return utc_now().isoformat() + "Z"


def make_visitor_id(store_id: str, track_id: int, utc_date_string: str) -> str:
    """Create a stable in-session visitor ID from store, track ID, and UTC date."""
    digest = hashlib.sha256(f"{store_id}{track_id}{utc_date_string}".encode("utf-8"))
    return "VIS_" + digest.hexdigest()[:6]


def is_staff(frame: np.ndarray, bbox: np.ndarray) -> bool:
    """Return whether a person crop is likely staff based on clothing color.

    TODO: Replace this placeholder with HSV saturation uniformity detection for
    staff uniforms once store-specific uniform colors are known.
    """
    return False


def run_yolo_person_detections(model: YOLO, frame: np.ndarray) -> sv.Detections:
    """Run YOLOv8 on a frame and return person-only detections for ByteTrack."""
    results = model(frame, classes=[PERSON_CLASS_ID], conf=PERSON_CONFIDENCE_THRESHOLD, verbose=False)
    result = results[0]

    if result.boxes is None or len(result.boxes) == 0:
        return sv.Detections.empty()

    xyxy = result.boxes.xyxy.cpu().numpy()
    confidence = result.boxes.conf.cpu().numpy()
    class_id = result.boxes.cls.cpu().numpy().astype(int)

    person_mask = (class_id == PERSON_CLASS_ID) & (confidence > PERSON_CONFIDENCE_THRESHOLD)
    return sv.Detections(
        xyxy=xyxy[person_mask],
        confidence=confidence[person_mask],
        class_id=class_id[person_mask],
    )


def build_metadata(zone_name: str | None, session_seq: int) -> dict[str, Any]:
    """Build the metadata object required by the event schema."""
    return {
        "queue_depth": None,
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
        metadata=build_metadata(zone_name, session_seq),
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
    visitor_id = make_visitor_id(args.store_id, track_id, utc_date_string)
    staff = is_staff(frame, bbox)

    state = track_state.get(track_id)
    if state is None:
        state = {
            "visitor_id": visitor_id,
            "current_zone": zone_number,
            "zone_enter_time": frame_time,
            "last_seen": frame_time,
            "session_seq": 1,
            "exited": False,
            "dwell_last_emitted": frame_time,
        }
        track_state[track_id] = state

        if zone_number == ENTRY_ZONE_NUMBER:
            if reid_tracker.check_reentry(visitor_id):
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

            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                visitor_id,
                "ENTRY",
                frame_timestamp,
                zone_name,
                0,
                staff,
                confidence,
                state["session_seq"],
            )
        return

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

        if state["current_zone"] == ENTRY_ZONE_NUMBER:
            zone_name = zone_display_name(state["current_zone"], zones_dict)
            dwell_ms = int((state["last_seen"] - state["zone_enter_time"]).total_seconds() * 1000)
            emit_detection_event(
                events,
                args.output,
                args.store_id,
                args.camera_id,
                state["visitor_id"],
                "EXIT",
                frame_timestamp,
                zone_name,
                max(dwell_ms, 0),
                False,
                0.0,
                state["session_seq"],
            )
            reid_tracker.mark_exit(state["visitor_id"])

        state["exited"] = True


def process_clip(args: argparse.Namespace) -> list[dict[str, Any]]:
    """Process one MP4 clip and return all emitted events."""
    zones_dict = zones.load_zones(args.layout)
    cap = cv2.VideoCapture(args.clip)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video clip: {args.clip}")

    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    if os.path.exists(args.output):
        open(args.output, "w", encoding="utf-8").close()

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    sample_every = max(int(video_fps), 1)

    model = YOLO("yolov8n.pt")
    tracker = sv.ByteTrack()
    reid_tracker = ReIDTracker()
    track_state: dict[int, dict[str, Any]] = {}
    events: list[dict[str, Any]] = []

    frame_number = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_number % sample_every != 0:
                frame_number += 1
                continue

            frame_time = utc_now()
            frame_timestamp = frame_time.isoformat() + "Z"
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
