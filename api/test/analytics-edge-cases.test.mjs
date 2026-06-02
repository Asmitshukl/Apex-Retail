/*
# PROMPT: Generate edge-case tests for the store analytics layer: empty store, all-staff events excluded from customer metrics, zero purchases, billing queue abandonment, and REENTRY sessions. Use the challenge requirement that staff must be excluded and re-entry should not inflate unique visitors.
# CHANGES MADE: Removed brittle wall-clock assumptions, used fixed April 16 2026 timestamps from the CCTV clips, and added explicit re-entry session assertions matching the final tracker design.
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  computeActiveQueueDepth,
  dropoff,
  hasPurchaseMatch,
  reconstructSessions,
} from "../dist/lib/analytics.js";

function event(overrides = {}) {
  return {
    eventId: overrides.eventId ?? `evt_${Math.random().toString(16).slice(2)}`,
    storeId: overrides.storeId ?? "STORE_BLR_002",
    cameraId: overrides.cameraId ?? "CAM_ENTRY_01",
    visitorId: overrides.visitorId ?? "VIS_001",
    eventType: overrides.eventType ?? "ENTRY",
    timestamp: overrides.timestamp ?? new Date("2026-04-16T08:00:00Z"),
    zoneId: overrides.zoneId ?? null,
    dwellMs: overrides.dwellMs ?? 0,
    isStaff: overrides.isStaff ?? false,
    confidence: overrides.confidence ?? 0.9,
    metadata: overrides.metadata ?? {},
    ingestedAt: overrides.ingestedAt ?? new Date("2026-04-16T08:00:01Z"),
  };
}

function transaction(overrides = {}) {
  return {
    transactionId: overrides.transactionId ?? "TXN_001",
    storeId: overrides.storeId ?? "STORE_BLR_002",
    timestamp: overrides.timestamp ?? new Date("2026-04-16T08:05:00Z"),
    basketValue: overrides.basketValue ?? 700,
  };
}

test("empty store periods do not create sessions or dropoff errors", () => {
  assert.deepEqual(reconstructSessions([]), []);
  assert.equal(dropoff(0, 0), 0);
});

test("zero purchases keep conversion matching false", () => {
  const billingEvents = [
    event({
      eventType: "BILLING_QUEUE_JOIN",
      zoneId: "BILLING",
      timestamp: new Date("2026-04-16T08:04:00Z"),
    }),
  ];

  assert.equal(hasPurchaseMatch(billingEvents, []), false);
});

test("purchase matching uses the five-minute billing window", () => {
  const billingEvents = [
    event({
      eventType: "BILLING_QUEUE_JOIN",
      zoneId: "BILLING",
      timestamp: new Date("2026-04-16T08:01:00Z"),
    }),
  ];

  assert.equal(
    hasPurchaseMatch(billingEvents, [
      transaction({ timestamp: new Date("2026-04-16T08:05:30Z") }),
    ]),
    true,
  );
  assert.equal(
    hasPurchaseMatch(billingEvents, [
      transaction({ timestamp: new Date("2026-04-16T08:07:30Z") }),
    ]),
    false,
  );
});

test("active queue depth counts only visitors whose latest billing state is join", () => {
  const events = [
    event({
      visitorId: "VIS_A",
      eventType: "BILLING_QUEUE_JOIN",
      timestamp: new Date("2026-04-16T08:01:00Z"),
    }),
    event({
      visitorId: "VIS_B",
      eventType: "BILLING_QUEUE_JOIN",
      timestamp: new Date("2026-04-16T08:01:30Z"),
    }),
    event({
      visitorId: "VIS_B",
      eventType: "EXIT",
      timestamp: new Date("2026-04-16T08:02:00Z"),
    }),
  ];

  assert.equal(computeActiveQueueDepth(events), 1);
});

test("re-entry starts a new session for the same visitor id", () => {
  const sessions = reconstructSessions([
    event({
      visitorId: "VIS_RETURNING",
      eventType: "ENTRY",
      timestamp: new Date("2026-04-16T08:00:00Z"),
    }),
    event({
      visitorId: "VIS_RETURNING",
      eventType: "EXIT",
      timestamp: new Date("2026-04-16T08:05:00Z"),
    }),
    event({
      visitorId: "VIS_RETURNING",
      eventType: "REENTRY",
      timestamp: new Date("2026-04-16T08:45:00Z"),
    }),
  ]);

  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((session) => session.sessionId), [
    "VIS_RETURNING:1",
    "VIS_RETURNING:2",
  ]);
});
