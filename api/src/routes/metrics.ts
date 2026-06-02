import { Router } from "express";

import { getStoreMetrics } from "../services/metricsService.js";

const router = Router();

router.get("/", async (req, res) => {
  const storeId = typeof req.query["store_id"] === "string" && req.query["store_id"].trim()
    ? req.query["store_id"].trim()
    : "STORE_BLR_002";

  res.json(await getStoreMetrics(storeId));
});

router.get("/:id/metrics", async (req, res) => {
  const storeId = req.params["id"];
  if (!storeId) {
    res.status(400).json({ error: "store id is required" });
    return;
  }

  res.json(await getStoreMetrics(storeId));
});

export default router;
