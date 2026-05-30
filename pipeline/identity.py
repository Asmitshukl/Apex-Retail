"""Cross-camera visitor identity registry."""

from __future__ import annotations

from datetime import datetime

import numpy as np


class CrossCameraRegistry:
    """Deduplicate visitor IDs across cameras with embedding similarity."""

    def __init__(self, threshold: float = 0.92) -> None:
        """Create an in-memory registry with a cosine similarity threshold."""
        self.threshold = threshold
        self.registry: dict[str, dict[str, object]] = {}

    def find_or_create(
        self,
        embedding: np.ndarray,
        candidate_id: str,
        seen_at: datetime | None = None,
    ) -> str:
        """Return an existing visitor ID for a matching embedding or store a candidate."""
        current_time = seen_at or datetime.utcnow()

        for visitor_id, entry in self.registry.items():
            last_seen = entry["last_seen"]
            if isinstance(last_seen, datetime):
                gap_seconds = (current_time - last_seen).total_seconds()
                if gap_seconds >= 300:
                    continue

            stored_embedding = entry["embedding"]
            similarity = float(np.dot(stored_embedding, embedding))
            if similarity >= self.threshold:
                entry["last_seen"] = current_time
                return visitor_id

        self.registry[candidate_id] = {
            "embedding": embedding,
            "last_seen": current_time,
        }
        return candidate_id

    def update(
        self,
        visitor_id: str,
        embedding: np.ndarray,
        seen_at: datetime | None = None,
    ) -> None:
        """Update a visitor embedding with a normalized running average."""
        current_time = seen_at or datetime.utcnow()
        entry = self.registry.get(visitor_id)
        if entry is None:
            self.registry[visitor_id] = {
                "embedding": embedding,
                "last_seen": current_time,
            }
            return

        old_embedding = entry["embedding"]
        averaged = ((old_embedding + embedding) / 2.0).astype(np.float32)
        norm = np.linalg.norm(averaged)
        if norm > 0:
            averaged = averaged / norm
        entry["embedding"] = averaged
        entry["last_seen"] = current_time
