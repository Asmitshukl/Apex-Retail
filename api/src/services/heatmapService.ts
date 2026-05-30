import prisma from "../db/client.js";
import { reconstructSessions } from "../lib/analytics.js";

export async function getStoreHeatmap(storeId: string) {
  const events = await prisma.event.findMany({
    where: { storeId, isStaff: false, zoneId: { not: null } },
    orderBy: { timestamp: "asc" },
  });

  const zones = new Map<string, { zone_id: string; frequency: number; dwellTotal: number; dwellCount: number }>();
  for (const event of events) {
    if (!event.zoneId) {
      continue;
    }
    const current = zones.get(event.zoneId) ?? {
      zone_id: event.zoneId,
      frequency: 0,
      dwellTotal: 0,
      dwellCount: 0,
    };
    if (event.eventType === "ZONE_ENTER") {
      current.frequency += 1;
    }
    if (event.eventType === "ZONE_DWELL") {
      current.dwellTotal += event.dwellMs;
      current.dwellCount += 1;
    }
    zones.set(event.zoneId, current);
  }

  const maxFrequency = Math.max(0, ...[...zones.values()].map((zone) => zone.frequency));
  const totalUniqueSessions = reconstructSessions(events).length;

  return {
    store_id: storeId,
    data_confidence: totalUniqueSessions >= 20,
    zones: [...zones.values()].map((zone) => ({
      zone_id: zone.zone_id,
      frequency: zone.frequency,
      avg_dwell_ms: zone.dwellCount === 0 ? 0 : Math.round(zone.dwellTotal / zone.dwellCount),
      normalised_score: maxFrequency === 0 ? 0 : Math.round((zone.frequency / maxFrequency) * 100),
    })),
    computed_at: new Date().toISOString(),
  };
}
