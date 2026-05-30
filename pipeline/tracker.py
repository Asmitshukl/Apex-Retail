"""Future Re-ID support for visitor reentry detection."""

from __future__ import annotations

from datetime import datetime

import cv2
import numpy as np


class ReIDTracker:
    """Track visitor exits for future reentry detection.

    This class intentionally does not load an OSNet or torchreid model yet. The
    detection layer currently uses hash-based visitor IDs as the primary identity.
    """

    def __init__(self) -> None:
        """Create an in-memory exit log keyed by visitor ID."""
        self.exit_log: dict[str, datetime] = {}
        self.embeddings: dict[str, np.ndarray] = {}
        self.threshold = 0.75

    def extract_embedding(self, frame: np.ndarray, bbox: np.ndarray) -> np.ndarray:
        """Extract a normalized 96-dimensional HSV color histogram embedding."""
        x1, y1, x2, y2 = [int(round(value)) for value in bbox]
        height, width = frame.shape[:2]
        x1 = max(0, min(x1, width - 1))
        x2 = max(0, min(x2, width))
        y1 = max(0, min(y1, height - 1))
        y2 = max(0, min(y2, height))

        if x2 <= x1 or y2 <= y1:
            return np.zeros(96, dtype=np.float32)

        crop = frame[y1:y2, x1:x2]
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        hist_h = cv2.calcHist([hsv], [0], None, [32], [0, 180]).flatten()
        hist_s = cv2.calcHist([hsv], [1], None, [32], [0, 256]).flatten()
        hist_v = cv2.calcHist([hsv], [2], None, [32], [0, 256]).flatten()
        embedding = np.concatenate([hist_h, hist_s, hist_v]).astype(np.float32)
        norm = np.linalg.norm(embedding)
        if norm == 0:
            return embedding
        return embedding / norm

    def match(self, embedding: np.ndarray) -> str | None:
        """Match an embedding against exited visitors using cosine similarity."""
        best_visitor_id = None
        best_similarity = self.threshold

        for visitor_id in self.exit_log:
            stored_embedding = self.embeddings.get(visitor_id)
            if stored_embedding is None:
                continue
            similarity = float(np.dot(stored_embedding, embedding))
            if similarity > best_similarity:
                best_similarity = similarity
                best_visitor_id = visitor_id

        return best_visitor_id

    def register(self, visitor_id: str, embedding: np.ndarray) -> None:
        """Store or replace a visitor embedding."""
        self.embeddings[visitor_id] = embedding

    def mark_exit(self, visitor_id: str, exit_time: datetime | None = None) -> None:
        """Record the UTC time when a visitor exits."""
        self.exit_log[visitor_id] = exit_time or datetime.utcnow()

    def has_exit(self, visitor_id: str) -> bool:
        """Return True if a visitor has an unconsumed prior exit."""
        return visitor_id in self.exit_log

    def check_reentry(
        self,
        visitor_id: str,
        window_seconds: int = 600,
        reference_time: datetime | None = None,
    ) -> bool:
        """Return True if a visitor exited within the recent reentry window."""
        exit_time = self.exit_log.get(visitor_id)
        if exit_time is None:
            return False

        current_time = reference_time or datetime.utcnow()
        delta_seconds = (current_time - exit_time).total_seconds()
        return delta_seconds < window_seconds

    def clear_exit(self, visitor_id: str) -> None:
        """Remove a visitor from the exit log after a reentry is consumed."""
        self.exit_log.pop(visitor_id, None)
