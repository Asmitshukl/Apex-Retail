import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

import prisma from "./client.js";
import { logger } from "../middleware/logger.js";

type PosCsvRow = {
  store_id?: string;
  transaction_id?: string;
  timestamp?: string;
  basket_value_inr?: string;
};

export async function seedPosTransactions(): Promise<void> {
  const csvPath = path.resolve(process.cwd(), "../pipeline/data/pos_transactions.csv");

  let csvContent: string;
  try {
    csvContent = await fs.readFile(csvPath, "utf8");
  } catch (err) {
    logger.warn({ err, csv_path: csvPath }, "POS transactions CSV not found; skipping seed");
    return;
  }

  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as PosCsvRow[];

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const storeId = row.store_id;
    const transactionId = row.transaction_id;
    const timestamp = row.timestamp ? new Date(row.timestamp) : null;
    const basketValue = row.basket_value_inr ? Number(row.basket_value_inr) : Number.NaN;

    if (!storeId || !transactionId || !timestamp || Number.isNaN(timestamp.getTime()) || !Number.isFinite(basketValue)) {
      skipped += 1;
      continue;
    }

    const existing = await prisma.posTransaction.findUnique({
      where: { transactionId },
      select: { transactionId: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.posTransaction.create({
      data: {
        transactionId,
        storeId,
        timestamp,
        basketValue,
      },
    });
    inserted += 1;
  }

  logger.info({ inserted, skipped, csv_path: csvPath }, "POS transactions seeded");
}
