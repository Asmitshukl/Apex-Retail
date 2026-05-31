import prisma from "../db/client.js";
import { hasPurchaseMatch, isBillingEvent } from "../lib/analytics.js";
import { logger } from "../middleware/logger.js";

export async function getStoreMetrics(storeId: string) {
  logger.info(
    {
      sql: "SELECT COUNT DISTINCT visitor_id...",
      params: [storeId],
    },
    "Computing unique visitors",
  );

  const [events, transactions, dwellGroups] = await Promise.all([
    prisma.event.findMany({
      where: { storeId, isStaff: false },
      orderBy: { timestamp: "asc" },
    }),
    prisma.posTransaction.findMany({
      where: { storeId },
      orderBy: { timestamp: "asc" },
    }),
    prisma.event.groupBy({
      by: ["zoneId"],
      where: {
        storeId,
        isStaff: false,
        eventType: "ZONE_DWELL",
        zoneId: { not: null },
      },
      _avg: { dwellMs: true },
    }),
  ]);

  const entryVisitorIds = new Set<string>();
  const exitedVisitorIds = new Set<string>();
  const joinedQueueIds = new Set<string>();
  const abandonedQueueIds = new Set<string>();

  for (const event of events) {
    if (!event.visitorId) {
      continue;
    }
    if (event.eventType === "ENTRY" || event.eventType === "REENTRY") {
      entryVisitorIds.add(event.visitorId);
    }
    if (event.eventType === "EXIT") {
      exitedVisitorIds.add(event.visitorId);
    }
    if (event.eventType === "BILLING_QUEUE_JOIN") {
      joinedQueueIds.add(event.visitorId);
    }
    if (event.eventType === "BILLING_QUEUE_ABANDON") {
      abandonedQueueIds.add(event.visitorId);
    }
  }

  const unique_visitors = [...entryVisitorIds].filter((visitorId) => exitedVisitorIds.has(visitorId)).length;
  const convertedVisitors = new Set<string>();
  for (const visitorId of entryVisitorIds) {
    const visitorEvents = events.filter((event) => event.visitorId === visitorId);
    if (hasPurchaseMatch(visitorEvents.filter(isBillingEvent), transactions)) {
      convertedVisitors.add(visitorId);
    }
  }

  const avgDwellByZone = Object.fromEntries(
    dwellGroups
      .filter((row) => row.zoneId !== null)
      .map((row) => [row.zoneId as string, Math.round(row._avg.dwellMs ?? 0)]),
  );

  const queueDepth = [...joinedQueueIds].filter(
    (visitorId) => !abandonedQueueIds.has(visitorId) && !exitedVisitorIds.has(visitorId),
  ).length;

  return {
    store_id: storeId,
    unique_visitors,
    conversion_rate: unique_visitors === 0 ? null : convertedVisitors.size / unique_visitors,
    avg_dwell_by_zone: avgDwellByZone,
    queue_depth: Math.max(0, queueDepth),
    abandonment_rate: joinedQueueIds.size === 0 ? null : abandonedQueueIds.size / joinedQueueIds.size,
    computed_at: new Date().toISOString(),
  };
}
