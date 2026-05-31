import type { Prisma } from "@prisma/client";
import { z } from "zod";

import prisma from "../db/client.js";

export const eventSchema = z.object({
  event_id: z.string().uuid(),
  store_id: z.string().min(1),
  camera_id: z.string().min(1),
  visitor_id: z.string().min(1),
  event_type: z.enum([
    "ENTRY",
    "EXIT",
    "ZONE_ENTER",
    "ZONE_EXIT",
    "ZONE_DWELL",
    "BILLING_QUEUE_JOIN",
    "BILLING_QUEUE_ABANDON",
    "REENTRY",
  ]),
  timestamp: z.string().datetime(),
  zone_id: z.string().nullable(),
  dwell_ms: z.number().int().min(0),
  is_staff: z.boolean(),
  confidence: z.number().min(0).max(1),
  metadata: z
    .object({
      queue_depth: z.number().nullable().optional(),
      sku_zone: z.string().nullable().optional(),
      session_seq: z.number().int().optional(),
    })
    .passthrough(),
});

const ingestSchema = z.object({
  events: z.array(eventSchema).max(500),
});

export type IngestResult = {
  accepted: number;
  duplicates: number;
  rejected: number;
  errors: Array<{ event_id?: string; reason: string }>;
  eventCount: number;
  storeIds: string[];
};

export async function ingestEvents(body: unknown): Promise<IngestResult> {
  const eventsValue = body && typeof body === "object" && "events" in body ? (body as { events?: unknown }).events : undefined;
  const rawEvents = Array.isArray(eventsValue) ? eventsValue : [];
  const envelope = ingestSchema.safeParse(body);
  const validEvents: z.infer<typeof eventSchema>[] = [];
  const errors: Array<{ event_id?: string; reason: string }> = [];

  if (!envelope.success) {
    if (rawEvents.length > 500) {
      errors.push({ reason: "events array must contain at most 500 items" });
    }
    if (!Array.isArray(eventsValue)) {
      errors.push({ reason: "body.events must be an array" });
    }
  }

  for (const rawEvent of rawEvents.slice(0, 500)) {
    const parsed = eventSchema.safeParse(rawEvent);
    const eventId =
      rawEvent && typeof rawEvent === "object" && "event_id" in rawEvent
        ? String((rawEvent as { event_id?: unknown }).event_id ?? "")
        : undefined;

    if (!parsed.success) {
      errors.push({
        ...(eventId ? { event_id: eventId } : {}),
        reason: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      continue;
    }

    validEvents.push(parsed.data);
  }

  let accepted = 0;
  let duplicates = 0;
  const storeIds = new Set<string>();

  for (const event of validEvents) {
    storeIds.add(event.store_id);
    const existing = await prisma.event.findUnique({
      where: { eventId: event.event_id },
      select: { eventId: true },
    });

    if (existing) {
      duplicates += 1;
      continue;
    }

    const data = {
        eventId: event.event_id,
        storeId: event.store_id,
        cameraId: event.camera_id,
        visitorId: event.visitor_id,
        eventType: event.event_type,
        timestamp: new Date(event.timestamp),
        zoneId: event.zone_id,
        dwellMs: event.dwell_ms,
        isStaff: event.is_staff,
        confidence: event.confidence,
        metadata: event.metadata as Prisma.InputJsonValue,
    };

    await prisma.event.upsert({
      where: { eventId: event.event_id },
      update: {},
      create: data,
    });
    accepted += 1;
  }

  return {
    accepted,
    duplicates,
    rejected: errors.length,
    errors,
    eventCount: rawEvents.length,
    storeIds: [...storeIds],
  };
}
