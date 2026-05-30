"""Future Re-ID support for visitor reentry detection."""

from __future__ import annotations

from datetime import datetime


class ReIDTracker:
    """Track visitor exits for future reentry detection.

    This class intentionally does not load an OSNet or torchreid model yet. The
    detection layer currently uses hash-based visitor IDs as the primary identity.
    """

    def __init__(self) -> None:
        """Create an in-memory exit log keyed by visitor ID."""
        self.exit_log: dict[str, datetime] = {}
        # TODO: Load torchreid.utils.FeatureExtractor with OSNet when visual
        # re-identification becomes part of the hot path.

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
