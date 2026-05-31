import express from "express";

import { errorHandler } from "./middleware/errors.js";
import { httpLogger } from "./middleware/logger.js";
import anomaliesRouter from "./routes/anomalies.js";
import eventsRouter from "./routes/events.js";
import funnelRouter from "./routes/funnel.js";
import healthRouter from "./routes/health.js";
import heatmapRouter from "./routes/heatmap.js";
import metricsRouter from "./routes/metrics.js";
import pipelineRouter from "./routes/pipeline.js";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "10mb" }));
  app.use(httpLogger);

  app.use("/events", eventsRouter);
  app.use("/pipeline", pipelineRouter);
  app.use("/stores", metricsRouter);
  app.use("/stores", funnelRouter);
  app.use("/stores", heatmapRouter);
  app.use("/stores", anomaliesRouter);
  app.use("/health", healthRouter);

  app.use(errorHandler);

  return app;
}
