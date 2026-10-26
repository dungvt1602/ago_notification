-- ============================================================
-- BÁO GIÁ NHÀ CUNG CẤP (RFQ) QUA ZALO — PLAN-0001: suppliers, supplier_rfqs, supplier_rfq_items,
-- supplier_rfq_images, supplier_rfq_invitations, supplier_quotes, supplier_quote_items.
-- ------------------------------------------------------------
-- AN TOÀN: CHỈ TẠO bảng/index/FK mới, không đụng dữ liệu hiện có. Idempotent — chạy lại được.
-- Chạy trên Supabase SQL Editor (hoặc `prisma db push`, kết quả giống hệt). Tên index/ràng buộc khớp
-- quy ước Prisma để `db push` sau đó báo "in sync". Chạy SAU 2026-10-19-outbox-events.sql
-- (nộp giá ghi outbox_events cùng transaction).
-- ============================================================

-- 1) Bảng
CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "company" VARCHAR(255),
    "phone" VARCHAR(30),
    "email" VARCHAR(255),
    "zalo_user_id" VARCHAR(50),
    "note" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supplier_rfqs" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "note" TEXT,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'VND',
    "deadline" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_rfqs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supplier_rfq_items" (
    "id" BIGSERIAL NOT NULL,
    "rfq_id" BIGINT NOT NULL,
    "no" INTEGER NOT NULL,
    "product" VARCHAR(255) NOT NULL,
    "spec" VARCHAR(500),
    "unit" VARCHAR(50),
    "quantity" DECIMAL(18,4),
    "note" TEXT,

    CONSTRAINT "supplier_rfq_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supplier_rfq_images" (
    "rfq_id" BIGINT NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_rfq_images_pkey" PRIMARY KEY ("rfq_id")
);

CREATE TABLE IF NOT EXISTS "supplier_rfq_invitations" (
    "id" BIGSERIAL NOT NULL,
    "rfq_id" BIGINT NOT NULL,
    "supplier_id" BIGINT,
    "token_hash" VARCHAR(64) NOT NULL,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "viewed_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "channel" VARCHAR(20) NOT NULL DEFAULT 'ZALO',
    "message_id" VARCHAR(100),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_rfq_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supplier_quotes" (
    "id" BIGSERIAL NOT NULL,
    "invitation_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "valid_until" DATE,
    "note" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supplier_quote_items" (
    "id" BIGSERIAL NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "rfq_item_id" BIGINT NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "moq" DECIMAL(18,4),
    "lead_time_days" INTEGER,
    "note" TEXT,

    CONSTRAINT "supplier_quote_items_pkey" PRIMARY KEY ("id")
);

-- 2) Index
CREATE INDEX IF NOT EXISTS "suppliers_name_idx" ON "suppliers"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_rfqs_code_key" ON "supplier_rfqs"("code");
CREATE INDEX IF NOT EXISTS "supplier_rfqs_status_created_at_idx" ON "supplier_rfqs"("status", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_rfq_items_rfq_id_no_key" ON "supplier_rfq_items"("rfq_id", "no");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_rfq_invitations_token_hash_key" ON "supplier_rfq_invitations"("token_hash");
CREATE INDEX IF NOT EXISTS "supplier_rfq_invitations_supplier_id_idx" ON "supplier_rfq_invitations"("supplier_id");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_rfq_invitations_rfq_id_supplier_id_key" ON "supplier_rfq_invitations"("rfq_id", "supplier_id");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_quotes_invitation_id_version_key" ON "supplier_quotes"("invitation_id", "version");
CREATE INDEX IF NOT EXISTS "supplier_quote_items_rfq_item_id_idx" ON "supplier_quote_items"("rfq_item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_quote_items_quote_id_rfq_item_id_key" ON "supplier_quote_items"("quote_id", "rfq_item_id");

-- 3) Khoá ngoại (bọc DO để chạy lại không lỗi duplicate_object)
DO $$ BEGIN
  ALTER TABLE "supplier_rfq_items" ADD CONSTRAINT "supplier_rfq_items_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "supplier_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_rfq_images" ADD CONSTRAINT "supplier_rfq_images_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "supplier_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_rfq_invitations" ADD CONSTRAINT "supplier_rfq_invitations_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "supplier_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_rfq_invitations" ADD CONSTRAINT "supplier_rfq_invitations_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "supplier_rfq_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "supplier_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_rfq_item_id_fkey" FOREIGN KEY ("rfq_item_id") REFERENCES "supplier_rfq_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
