-- CreateTable
CREATE TABLE "events" (
    "event_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "camera_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "zone_id" TEXT,
    "dwell_ms" INTEGER NOT NULL DEFAULT 0,
    "is_staff" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "pos_transactions" (
    "transaction_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "basket_value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "pos_transactions_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateIndex
CREATE INDEX "events_store_id_timestamp_idx" ON "events"("store_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "events_visitor_id_store_id_idx" ON "events"("visitor_id", "store_id");

-- CreateIndex
CREATE INDEX "events_store_id_event_type_idx" ON "events"("store_id", "event_type");

-- CreateIndex
CREATE INDEX "events_store_id_zone_id_idx" ON "events"("store_id", "zone_id");

-- CreateIndex
CREATE INDEX "pos_transactions_store_id_timestamp_idx" ON "pos_transactions"("store_id", "timestamp");
