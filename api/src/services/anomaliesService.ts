import prisma from "../db/client.js";
import { computeActiveQueueDepth, hasPurchaseMatch, isBillingEvent } from "../lib/analytics.js";

type Anomaly = {
  type: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  message: string;
  suggested_action: string;
  detected_at: string;
};

async function conversionRate(storeId: string, from: Date, to: Date): Promise<number | null> {
  const [events, transactions] = await Promise.all([
    prisma.event.findMany({
      where: { storeId, isStaff: false, timestamp: { gte: from, lte: to } },
      orderBy: { timestamp: "asc" },
    }),
    prisma.posTransaction.findMany({
      where: { storeId, timestamp: { gte: from, lte: to } },
      orderBy: { timestamp: "asc" },
    }),
  ]);
  const visitors = new Set(events.filter((event) => event.eventType === "ENTRY").map((event) => event.visitorId));
  if (visitors.size === 0) {
    return null;
  }
  let converted = 0;
  for (const visitorId of visitors) {
    const visitorEvents = events.filter((event) => event.visitorId === visitorId);
    if (hasPurchaseMatch(visitorEvents.filter(isBillingEvent), transactions)) {
      converted += 1;
    }
  }
  return converted / visitors.size;
}

export async function getStoreAnomalies(storeId: string) {
  const now = new Date();
  const detectedAt = now.toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const recentQueueEvents = await prisma.event.findMany({
    where: {
      storeId,
      isStaff: false,
      eventType: { in: ["BILLING_QUEUE_JOIN", "BILLING_QUEUE_ABANDON", "EXIT"] },
    },
    orderBy: { timestamp: "asc" },
  });
  const currentDepth = computeActiveQueueDepth(recentQueueEvents);

  const queueEvents7Day = recentQueueEvents.filter((event) => event.timestamp >= sevenDaysAgo);
  const dailyDepths: number[] = [];
  for (let day = 0; day < 7; day += 1) {
    const end = new Date(sevenDaysAgo.getTime() + (day + 1) * 24 * 60 * 60 * 1000);
    dailyDepths.push(computeActiveQueueDepth(queueEvents7Day.filter((event) => event.timestamp <= end)));
  }
  const avg7Day = dailyDepths.reduce((sum, value) => sum + value, 0) / Math.max(dailyDepths.length, 1);

  const anomalies: Anomaly[] = [];
  const queueBaseline = Math.max(avg7Day, 1);
  if (currentDepth > 5 * queueBaseline) {
    anomalies.push({
      type: "BILLING_QUEUE_SPIKE",
      severity: "CRITICAL",
      message: `Current queue depth ${currentDepth} is more than 5x the 7-day average ${avg7Day.toFixed(2)}`,
      suggested_action: "Open additional billing counter immediately",
      detected_at: detectedAt,
    });
  } else if (currentDepth > 3 * queueBaseline) {
    anomalies.push({
      type: "BILLING_QUEUE_SPIKE",
      severity: "WARN",
      message: `Current queue depth ${currentDepth} is more than 3x the 7-day average ${avg7Day.toFixed(2)}`,
      suggested_action: "Open additional billing counter",
      detected_at: detectedAt,
    });
  }

  const todayRate = await conversionRate(storeId, startOfToday, now);
  const weekRate = await conversionRate(storeId, sevenDaysAgo, now);
  if (todayRate !== null && weekRate !== null && weekRate > 0 && todayRate < 0.7 * weekRate) {
    anomalies.push({
      type: "CONVERSION_DROP",
      severity: "WARN",
      message: `Today's conversion rate ${todayRate.toFixed(3)} is below 70% of the 7-day rate ${weekRate.toFixed(3)}`,
      suggested_action: "Review floor staff positioning and zone signage",
      detected_at: detectedAt,
    });
  }

  const everZones = await prisma.event.findMany({
    where: { storeId, eventType: "ZONE_ENTER", zoneId: { not: null } },
    distinct: ["zoneId"],
    select: { zoneId: true },
  });
  for (const zone of everZones) {
    if (!zone.zoneId) {
      continue;
    }
    const recent = await prisma.event.findFirst({
      where: {
        storeId,
        zoneId: zone.zoneId,
        eventType: "ZONE_ENTER",
        timestamp: { gte: thirtyMinutesAgo },
      },
      select: { eventId: true },
    });
    if (!recent) {
      anomalies.push({
        type: "DEAD_ZONE",
        severity: "INFO",
        message: `No ZONE_ENTER events for zone ${zone.zoneId} in the last 30 minutes`,
        suggested_action: `Check camera feed for zone ${zone.zoneId}`,
        detected_at: detectedAt,
      });
    }
  }

  return {
    store_id: storeId,
    anomalies,
    computed_at: detectedAt,
  };
}
