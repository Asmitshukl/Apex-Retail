import prisma from "../db/client.js";
import { dropoff, hasPurchaseMatch, isBillingEvent, reconstructSessions } from "../lib/analytics.js";

export async function getStoreFunnel(storeId: string) {
  const [events, transactions, entryResult] = await Promise.all([
    prisma.event.findMany({
      where: { storeId, isStaff: false },
      orderBy: { timestamp: "asc" },
    }),
    prisma.posTransaction.findMany({
      where: { storeId },
      orderBy: { timestamp: "asc" },
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "visitor_id") as count
      FROM "events"
      WHERE "store_id" = ${storeId}
      AND "event_type" = 'ENTRY'
      AND "is_staff" = false
    `,
  ]);

  const entrySessions = Number(entryResult[0]?.count ?? 0);
  const sessions = reconstructSessions(events).filter((session) =>
    session.events.some((event) => event.eventType === "ENTRY" || event.eventType === "REENTRY"),
  );
  const zoneVisit = sessions.filter((session) =>
    session.events.some((event) => event.eventType === "ZONE_ENTER"),
  ).length;
  const billingQueue = sessions.filter((session) =>
    session.events.some((event) => event.eventType === "BILLING_QUEUE_JOIN"),
  ).length;
  const purchase = sessions.filter((session) =>
    hasPurchaseMatch(session.events.filter(isBillingEvent), transactions),
  ).length;

  return {
    store_id: storeId,
    funnel: [
      { stage: "ENTRY", count: entrySessions, dropoff_pct: 0 },
      { stage: "ZONE_VISIT", count: zoneVisit, dropoff_pct: dropoff(entrySessions, zoneVisit) },
      { stage: "BILLING_QUEUE", count: billingQueue, dropoff_pct: dropoff(zoneVisit, billingQueue) },
      { stage: "PURCHASE", count: purchase, dropoff_pct: dropoff(billingQueue, purchase) },
    ],
    computed_at: new Date().toISOString(),
  };
}
