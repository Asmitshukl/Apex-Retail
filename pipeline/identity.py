"""Cross-camera visitor identity registry."""

from __future__ import annotations

import numpy as np


class CrossCameraRegistry:
    """Deduplicate visitor IDs across cameras with embedding similarity."""

    def __init__(self, threshold: float = 0.80) -> None:
        """Create an in-memory registry with a cosine similarity threshold."""
        self.threshold = threshold
        self.registry: dict[str, np.ndarray] = {}

    def find_or_create(self, embedding: np.ndarray, candidate_id: str) -> str:
        """Return an existing visitor ID for a matching embedding or store a candidate."""
        for visitor_id, stored_embedding in self.registry.items():
            similarity = float(np.dot(stored_embedding, embedding))
            if similarity >= self.threshold:
                return visitor_id

        self.registry[candidate_id] = embedding
        return candidate_id

    def update(self, visitor_id: str, embedding: np.ndarray) -> None:
        """Update a visitor embedding with a normalized running average."""
        old_embedding = self.registry.get(visitor_id)
        if old_embedding is None:
            self.registry[visitor_id] = embedding
            return

        averaged = ((old_embedding + embedding) / 2.0).astype(np.float32)
        norm = np.linalg.norm(averaged)
        if norm > 0:
            averaged = averaged / norm
        self.registry[visitor_id] = averaged
