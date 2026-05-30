"""Zone loading and point-in-polygon classification for store layouts."""

from __future__ import annotations

import json
from typing import Any


def load_zones(layout_path: str) -> dict[str, dict[str, Any]]:
    """Load numbered store zones from a store layout JSON file.

    The expected layout shape is:
    {
      "zones": {
        "0": {"name": "Entry", "polygon": [[0, 0], [20, 0], ...]}
      }
    }

    Polygons are expressed as percentages of frame width and height.
    """
    with open(layout_path, "r", encoding="utf-8") as layout_file:
        layout = json.load(layout_file)

    zones = layout.get("zones")
    if not isinstance(zones, dict):
        raise ValueError("store_layout.json must contain a 'zones' object")

    for zone_number, zone_data in zones.items():
        if not isinstance(zone_data, dict):
            raise ValueError(f"Zone {zone_number} must be an object")
        if "name" not in zone_data or "polygon" not in zone_data:
            raise ValueError(f"Zone {zone_number} must include 'name' and 'polygon'")
        if not isinstance(zone_data["polygon"], list) or len(zone_data["polygon"]) < 3:
            raise ValueError(f"Zone {zone_number} polygon must contain at least 3 points")

    return zones


def classify_zone(
    cx: float,
    cy: float,
    frame_w: int,
    frame_h: int,
    zones: dict[str, dict[str, Any]],
) -> str | None:
    """Return the first zone number containing a centroid, or None if outside all zones.

    The centroid is converted from pixel coordinates into percentage coordinates
    before testing against each zone polygon with ray casting.
    """
    if frame_w <= 0 or frame_h <= 0:
        raise ValueError("frame_w and frame_h must be positive")

    point_x = (cx / frame_w) * 100.0
    point_y = (cy / frame_h) * 100.0

    for zone_number, zone_data in zones.items():
        polygon = zone_data["polygon"]
        if _point_in_polygon(point_x, point_y, polygon):
            return zone_number

    return None


def _point_in_polygon(x: float, y: float, polygon: list[list[float]]) -> bool:
    """Return True when a point is inside a polygon using ray casting."""
    inside = False
    point_count = len(polygon)
    j = point_count - 1

    for i in range(point_count):
        xi, yi = polygon[i]
        xj, yj = polygon[j]

        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i

    return inside
