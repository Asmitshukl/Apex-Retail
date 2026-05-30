import type { Event, PosTransaction } from "@prisma/client";

export type Session = {
  sessionId: string;
  visitorId: string;
  startedAt: Date;
  events: Event[];
};

export function isBillingEvent(event: Event): boolean {
  const metadata = event.metadata;
  const skuZone =
    metadata && typeof metadata === "object" && !Array.isArray(metadata) && "sku_zone" in metadata
      ? String((metadata as { sku_zone?: unknown }).sku_zone ?? "")
      : "";

  return (
    event.eventType === "BILLING_QUEUE_JOIN"
    || event.eventType === "BILLING_QUEUE_ABANDON"
    || (event.zoneId?.toLowerCase().includes("billing") ?? false)
    || skuZone.toLowerCase().includes("billing")
  );
}

export function computeActiveQueueDepth(events: Event[]): number {
  const latestByVisitor = new Map<string, Event>();

  for (const event of [...events].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())) {
    if (!latestByVisitor.has(event.visitorId)) {
      latestByVisitor.set(event.visitorId, event);
    }
  }

  let active = 0;
  for (const event of latestByVisitor.values()) {
    if (event.eventType === "BILLING_QUEUE_JOIN") {
      active += 1;
    }
  }
  return active;
}

export function hasPurchaseMatch(events: Event[], transactions: PosTransaction[]): boolean {
  const billingEvents = events.filter(isBillingEvent);
  for (const transaction of transactions) {
    const windowStart = transaction.timestamp.getTime() - 5 * 60 * 1000;
    const transactionTime = transaction.timestamp.getTime();
    if (
      billingEvents.some((event) => {
        const eventTime = event.timestamp.getTime();
        return event.storeId === transaction.storeId && eventTime >= windowStart && eventTime <= transactionTime;
      })
    ) {
      return true;
    }
  }
  return false;
}

export function reconstructSessions(events: Event[]): Session[] {
  const byVisitor = new Map<string, Event[]>();
  for (const event of events) {
    const visitorEvents = byVisitor.get(event.visitorId) ?? [];
    visitorEvents.push(event);
    byVisitor.set(event.visitorId, visitorEvents);
  }

  const sessions: Session[] = [];
  for (const [visitorId, visitorEvents] of byVisitor.entries()) {
    visitorEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    let current: Session | null = null;
    let sessionSeq = 0;

    for (const event of visitorEvents) {
      if (event.eventType === "ENTRY" || event.eventType === "REENTRY" || current === null) {
        sessionSeq += 1;
        current = {
          sessionId: `${visitorId}:${sessionSeq}`,
          visitorId,
          startedAt: event.timestamp,
          events: [],
        };
        sessions.push(current);
      }
      current.events.push(event);
    }
  }

  return sessions;
}

export function dropoff(previous: number, current: number): number {
  if (previous <= 0) {
    return 0;
  }
  return Number((((previous - current) / previous) * 100).toFixed(2));
}
