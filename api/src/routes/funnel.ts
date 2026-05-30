import { Router } from "express";

import { getStoreFunnel } from "../services/funnelService.js";

const router = Router();

router.get("/:id/funnel", async (req, res) => {
  const storeId = req.params["id"];
  if (!storeId) {
    res.status(400).json({ error: "store id is required" });
    return;
  }

  res.json(await getStoreFunnel(storeId));
});

export default router;
