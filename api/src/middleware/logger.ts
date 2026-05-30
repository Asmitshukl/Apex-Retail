import crypto from "node:crypto";
import type { Request, Response } from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: Request) => {
    const traceId = crypto.randomUUID();
    req.id = traceId;
    return traceId;
  },
  customProps: (req: Request, res: Response) => ({
    trace_id: req.id,
    store_id: req.params["id"] ?? req.params["storeId"],
    endpoint: req.path,
    method: req.method,
    latency_ms: "responseTime" in res ? res.responseTime : undefined,
    status_code: res.statusCode,
  }),
});
