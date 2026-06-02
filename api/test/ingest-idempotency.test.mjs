/*
# PROMPT: Generate tests for /events/ingest idempotency, duplicate event handling, and invalid event rejection for the Store Intelligence API. The API uses event_id as the idempotency key and must safely accept the same JSONL-derived payload twice without double inserting.
# CHANGES MADE: Replaced generated database calls with an in-memory Prisma-shaped client, kept exact accepted/duplicates/rejected assertions, and aligned event field names with the pipeline schema: event_id, visitor_id, event_type, is_staff, dwell_ms, and metadata.
*/

import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:password@localhost:5432/store_intelligence";
const { ingestEventsWithClient } = await import("../dist/services/eventsService.js");

function createMockClient() {
  const stored = new Map();
  return {
    stored,
    client: {
      event: {
        async findUnique({ where }) {
          return stored.has(where.eventId) ? { eventId: where.eventId } : null;
        },
        async upsert({ where, create }) {
          if (!stored.has(where.eventId)) {
            stored.set(where.eventId, create);
          }
          return stored.get(where.eventId);
        },
      },
    },
  };
}

function validEvent(overrides = {}) {
  return {
    event_id: "11111111-1111-4111-8111-111111111111",
    store_id: "STORE_BLR_002",
    camera_id: "CAM_ENTRY_01",
    visitor_id: "VIS_TEST_001",
    event_type: "ENTRY",
    timestamp: "2026-04-16T08:00:00Z",
    zone_id: null,
    dwell_ms: 0,
    is_staff: false,
    confidence: 0.91,
    metadata: {
      session_seq: 1,
      group_entry: false,
    },
    ...overrides,
  };
}

test("ingest is idempotent for duplicate event_id payloads", async () => {
  const { client, stored } = createMockClient();
  const payload = { events: [validEvent()] };

  const first = await ingestEventsWithClient(payload, client);
  const second = await ingestEventsWithClient(payload, client);

  assert.deepEqual(
    {
      accepted: first.accepted,
      duplicates: first.duplicates,
      rejected: first.rejected,
      stored: stored.size,
    },
    {
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      stored: 1,
    },
  );
  assert.deepEqual(
    {
      accepted: second.accepted,
      duplicates: second.duplicates,
      rejected: second.rejected,
      stored: stored.size,
    },
    {
      accepted: 0,
      duplicates: 1,
      rejected: 0,
      stored: 1,
    },
  );
});

test("invalid events are rejected while valid events are accepted", async () => {
  const { client, stored } = createMockClient();
  const result = await ingestEventsWithClient(
    {
      events: [
        validEvent({ event_id: "22222222-2222-4222-8222-222222222222" }),
        validEvent({
          event_id: "not-a-uuid",
          event_type: "UNKNOWN_EVENT",
          confidence: 2,
        }),
      ],
    },
    client,
  );

  assert.equal(result.accepted, 1);
  assert.equal(result.duplicates, 0);
  assert.equal(result.rejected, 1);
  assert.equal(stored.size, 1);
  assert.match(result.errors[0]?.reason ?? "", /Invalid UUID|Invalid option|Too big|expected/i);
});
