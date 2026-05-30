import cluster from "node:cluster";
import os from "node:os";
import type { Server } from "node:http";

import prisma from "./db/client.js";
import { seedPosTransactions } from "./db/seed.js";
import { logger } from "./middleware/logger.js";
import { createApp } from "./app.js";

const PORT = Number(process.env["PORT"] ?? 3001);
const WORKER_COUNT = Number(process.env["WEB_CONCURRENCY"] ?? os.availableParallelism());

async function preparePrimaryProcess(): Promise<void> {
  await prisma.$connect();
  logger.info("Database connected");
  await seedPosTransactions();
  await prisma.$disconnect();
}

function forkWorkers(workerCount: number): void {
  for (let index = 0; index < workerCount; index += 1) {
    cluster.fork();
  }
}

async function startWorker(): Promise<Server> {
  await prisma.$connect();
  const app = createApp();
  const server = app.listen(PORT, () => {
    logger.info(
      {
        port: PORT,
        pid: process.pid,
        worker_id: cluster.worker?.id,
      },
      "API worker started",
    );
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal, pid: process.pid }, "API worker shutting down");
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}

export async function startClusteredServer(): Promise<void> {
  if (cluster.isPrimary) {
    try {
      await preparePrimaryProcess();
      const workerCount = Number.isInteger(WORKER_COUNT) && WORKER_COUNT > 0 ? WORKER_COUNT : 1;
      logger.info(
        {
          port: PORT,
          worker_count: workerCount,
          primary_pid: process.pid,
        },
        "Starting clustered API server",
      );
      forkWorkers(workerCount);

      cluster.on("exit", (worker, code, signal) => {
        logger.error(
          {
            worker_id: worker.id,
            worker_pid: worker.process.pid,
            code,
            signal,
          },
          "API worker exited; starting replacement",
        );
        cluster.fork();
      });
    } catch (err) {
      logger.error(err, "Failed to start clustered API server");
      process.exit(1);
    }
    return;
  }

  try {
    await startWorker();
  } catch (err) {
    logger.error(err, "Failed to start API worker");
    process.exit(1);
  }
}
