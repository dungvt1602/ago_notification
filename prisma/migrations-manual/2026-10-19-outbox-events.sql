-- ============================================================
-- TRANSACTIONAL OUTBOX: outbox_events + processed_events (giống ago_erp: identity.outbox_events / processed_events)
-- ------------------------------------------------------------
-- AN TOÀN: CHỈ TẠO bảng/ràng buộc/index mới, không đụng dữ liệu hiện có. Idempotent — chạy lại được.
-- Chạy trên Supabase SQL Editor, hoặc `prisma db push` (tạo bảng + index thường) rồi chạy phần 3-4 bên dưới
-- vì Prisma KHÔNG biểu diễn được CHECK constraint và partial index.
-- Khác ERP duy nhất: aggregate_id là VARCHAR(64) (khoá nghiệp vụ ở đây là BigInt, ERP dùng uuid).
-- ============================================================

-- 1) outbox_events
CREATE TABLE IF NOT EXISTS outbox_events (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  correlation_id  uuid,
  event_type      varchar(150)  NOT NULL,
  event_version   varchar(30)   NOT NULL,
  aggregate_type  varchar(100)  NOT NULL,
  aggregate_id    varchar(64),
  aggregate_code  varchar(150),
  payload         jsonb         NOT NULL,
  status          varchar(50)   NOT NULL,
  retry_count     integer       NOT NULL DEFAULT 0,
  last_error      text,
  locked_at       timestamptz(6),
  locked_by       varchar(100),
  created_at      timestamptz(6) NOT NULL DEFAULT now(),
  processed_at    timestamptz(6),
  sequence_no     bigserial     NOT NULL,
  CONSTRAINT outbox_events_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending     ON outbox_events (status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate   ON outbox_events (aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_events_correlation ON outbox_events (correlation_id);

-- 2) processed_events (consumer idempotent: 1 event_id chỉ được ghi nhận 1 lần)
CREATE TABLE IF NOT EXISTS processed_events (
  event_id        uuid          NOT NULL,
  source_module   varchar(100)  NOT NULL,
  event_type      varchar(150)  NOT NULL,
  event_version   varchar(30)   NOT NULL,
  correlation_id  uuid,
  processed_at    timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT processed_events_pkey PRIMARY KEY (event_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_events_source         ON processed_events (source_module, event_type);
CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at   ON processed_events (processed_at);
CREATE INDEX IF NOT EXISTS idx_processed_events_correlation    ON processed_events (correlation_id);

-- 3) CHECK constraint (Prisma không biểu diễn được). Tập trạng thái đồng bộ với ERP (có PROCESSED_NO_HANDLER).
DO $$ BEGIN
  ALTER TABLE outbox_events ADD CONSTRAINT ck_outbox_events_status
    CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'PROCESSED_NO_HANDLER', 'FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE outbox_events ADD CONSTRAINT ck_outbox_events_retry_count CHECK (retry_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) Partial index cho nhánh `not exists` của câu claim giữ THỨ TỰ xử lý trong từng aggregate;
--    chỉ đánh index dòng CHƯA xong để index nhỏ (Prisma không biểu diễn được partial index).
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate_pending
  ON outbox_events (aggregate_type, aggregate_id, created_at, sequence_no)
  WHERE status IN ('PENDING', 'PROCESSING', 'FAILED');

-- ---- Kiểm tra sau khi chạy (tuỳ chọn) ----
-- SELECT conname FROM pg_constraint WHERE conrelid = 'outbox_events'::regclass;
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('outbox_events', 'processed_events') ORDER BY 1;
