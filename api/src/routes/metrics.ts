import { Router } from "express";

import { getStoreMetrics } from "../services/metricsService.js";

const router = Router();

router.get("/:id/metrics", async (req, res) => {
  const storeId = req.params["id"];
  if (!storeId) {
    res.status(400).json({ error: "store id is required" });
    return;
  }

  res.json(await getStoreMetrics(storeId));
});

export default router;
