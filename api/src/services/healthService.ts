import prisma from "../db/client.js";

export async function getHealthStatus() {
  const checkedAt = new Date();
  let database: "connected" | "disconnected" = "connected";
  const stores: Array<{
    store_id: string;
    last_event: string;
    feed_status: "LIVE" | "STALE_FEED";
  }> = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "disconnected";
  }

  if (database === "connected") {
    try {
      const grouped = await prisma.event.groupBy({
        by: ["storeId"],
        _max: { timestamp: true },
      });

      for (const row of grouped) {
        const lastEvent = row._max.timestamp;
        if (!lastEvent) {
          continue;
        }
        const stale = checkedAt.getTime() - lastEvent.getTime() > 10 * 60 * 1000;
        stores.push({
          store_id: row.storeId,
          last_event: lastEvent.toISOString(),
          feed_status: stale ? "STALE_FEED" : "LIVE",
        });
      }
    } catch {
      database = "disconnected";
    }
  }

  const degraded = database === "disconnected" || stores.some((store) => store.feed_status === "STALE_FEED");

  return {
    statusCode: 200,
    body: {
      status: degraded ? "degraded" : "ok",
      database,
      stores,
      checked_at: checkedAt.toISOString(),
    },
  };
}
