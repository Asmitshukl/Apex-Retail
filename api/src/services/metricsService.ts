import prisma from "../db/client.js";
import { computeActiveQueueDepth, hasPurchaseMatch, isBillingEvent } from "../lib/analytics.js";

export async function getStoreMetrics(storeId: string) {
  const [events, transactions, dwellGroups, joins, abandons] = await Promise.all([
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
    prisma.event.count({
      where: { storeId, isStaff: false, eventType: "BILLING_QUEUE_JOIN" },
    }),
    prisma.event.count({
      where: { storeId, isStaff: false, eventType: "BILLING_QUEUE_ABANDON" },
    }),
  ]);

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
    unique_visitors: entryVisitorIds.size,
    conversion_rate: entryVisitorIds.size === 0 ? null : convertedVisitors.size / entryVisitorIds.size,
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
