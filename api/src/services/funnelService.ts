import prisma from "../db/client.js";
import { dropoff, hasPurchaseMatch, isBillingEvent, reconstructSessions } from "../lib/analytics.js";

export async function getStoreFunnel(storeId: string) {
  const [events, transactions] = await Promise.all([
    prisma.event.findMany({
      where: { storeId, isStaff: false },
      orderBy: { timestamp: "asc" },
    }),
    prisma.posTransaction.findMany({
      where: { storeId },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  const sessions = reconstructSessions(events).filter((session) =>
    session.events.some((event) => event.eventType === "ENTRY" || event.eventType === "REENTRY"),
  );
  const entry = sessions.length;
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
      { stage: "ENTRY", count: entry, dropoff_pct: 0 },
      { stage: "ZONE_VISIT", count: zoneVisit, dropoff_pct: dropoff(entry, zoneVisit) },
      { stage: "BILLING_QUEUE", count: billingQueue, dropoff_pct: dropoff(zoneVisit, billingQueue) },
      { stage: "PURCHASE", count: purchase, dropoff_pct: dropoff(billingQueue, purchase) },
    ],
    computed_at: new Date().toISOString(),
  };
}
