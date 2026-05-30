import type { NextFunction, Request, Response } from "express";

import { logger } from "./logger.js";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const traceId = String(req.id ?? "unknown");

  logger.error(
    {
      err,
      trace_id: traceId,
      endpoint: req.path,
      method: req.method,
      status_code: 500,
    },
    "Unhandled request error",
  );

  res.status(500).json({
    error: "Internal server error",
    trace_id: traceId,
  });
}
