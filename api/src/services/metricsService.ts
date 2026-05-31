import prisma from "../db/client.js";
import { computeActiveQueueDepth, hasPurchaseMatch, isBillingEvent } from "../lib/analytics.js";
import { logger } from "../middleware/logger.js";

export async function getStoreMetrics(storeId: string) {
  logger.info(
    {
      sql: "SELECT COUNT DISTINCT visitor_id...",
      params: [storeId],
    },
    "Computing unique visitors",
  );

  const [events, uniqueVisitorResult, transactions, dwellGroups, joins, abandons] = await Promise.all([
    prisma.event.findMany({
      where: { storeId, isStaff: false },
      orderBy: { timestamp: "asc" },
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "visitor_id") as count
      FROM "events"
      WHERE "store_id" = ${storeId}
      AND "event_type" = 'ENTRY'
      AND "is_staff" = false
    `,
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
    prisma.event.count({
      where: { storeId, isStaff: false, eventType: "BILLING_QUEUE_JOIN" },
    }),
    prisma.event.count({
      where: { storeId, isStaff: false, eventType: "BILLING_QUEUE_ABANDON" },
    }),
  ]);

  const unique_visitors = Number(uniqueVisitorResult[0]?.count ?? 0);
  const entryVisitorIds = new Set(
    events.filter((event) => event.eventType === "ENTRY").map((event) => event.visitorId),
  );
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

  return {
    store_id: storeId,
    unique_visitors,
    conversion_rate: unique_visitors === 0 ? null : convertedVisitors.size / unique_visitors,
    avg_dwell_by_zone: avgDwellByZone,
    queue_depth: computeActiveQueueDepth(
      events.filter((event) =>
        ["BILLING_QUEUE_JOIN", "BILLING_QUEUE_ABANDON", "EXIT"].includes(event.eventType),
      ),
    ),
    abandonment_rate: joins === 0 ? null : abandons / joins,
    computed_at: new Date().toISOString(),
  };
}
