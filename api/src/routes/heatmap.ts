import { Router } from "express";

import { getStoreHeatmap } from "../services/heatmapService.js";

const router = Router();

router.get("/:id/heatmap", async (req, res) => {
  const storeId = req.params["id"];
  if (!storeId) {
    res.status(400).json({ error: "store id is required" });
    return;
  }

  res.json(await getStoreHeatmap(storeId));
});

export default router;
