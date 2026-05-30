import { Router } from "express";

import { logger } from "../middleware/logger.js";
import { ingestEvents } from "../services/eventsService.js";

const router = Router();

router.post("/ingest", async (req, res) => {
  const start = performance.now();
  const result = await ingestEvents(req.body as unknown);
  const latencyMs = Math.round(performance.now() - start);

  logger.info(
    {
      trace_id: req.id,
      store_id: result.storeIds.join(",") || undefined,
      event_count: result.eventCount,
      accepted: result.accepted,
      duplicates: result.duplicates,
      rejected: result.rejected,
      latency_ms: latencyMs,
    },
    "Events ingest completed",
  );

  res.status(result.rejected > 0 ? 207 : 200).json({
    accepted: result.accepted,
    duplicates: result.duplicates,
    rejected: result.rejected,
    errors: result.errors,
  });
});

export default router;
