import { Router } from "express";

import { getHealthStatus } from "../services/healthService.js";

const router = Router();

router.get("/", async (_req, res) => {
  const result = await getHealthStatus();
  res.status(result.statusCode).json(result.body);
});

export default router;
