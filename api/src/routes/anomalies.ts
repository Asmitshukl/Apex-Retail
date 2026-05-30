import { Router } from "express";

import { getStoreAnomalies } from "../services/anomaliesService.js";

const router = Router();

router.get("/:id/anomalies", async (req, res) => {
  const storeId = req.params["id"];
  if (!storeId) {
    res.status(400).json({ error: "store id is required" });
    return;
  }

  res.json(await getStoreAnomalies(storeId));
});

export default router;
