-- ============================================
-- 005_stock_logs.sql
-- AUDIT TRAIL — wajib terisi setiap kali stok berubah ATAU rule menolak operasi.
-- Kolom: WHO (user_id), WHEN (created_at presisi millidetik), WHY (rule_triggered + rule_action + reason_detail)
-- ============================================

CREATE TABLE IF NOT EXISTS stock_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID REFERENCES products(id),
  user_id          UUID REFERENCES users(id),
  delta_qty        INTEGER     NOT NULL DEFAULT 0,
  stok_sebelum     INTEGER,
  stok_sesudah     INTEGER,
  source_type      VARCHAR(20) NOT NULL CHECK (source_type IN ('sales', 'purchase', 'manual')),
  rule_triggered   VARCHAR(10) CHECK (rule_triggered IN ('R1','R2','R3','R4','R5')),
  rule_action      VARCHAR(20) CHECK (rule_action IN ('TRIGGERED','REJECTED','ACCEPTED')),
  reason_detail    TEXT,
  context_payload  JSONB,
  created_at       TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_stock_logs_created_at     ON stock_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_logs_product_id     ON stock_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_logs_user_id        ON stock_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_stock_logs_rule_triggered ON stock_logs(rule_triggered);

ALTER TABLE stock_logs ENABLE ROW LEVEL SECURITY;

-- Hanya admin yang boleh baca audit trail dari client. Service role bypass.
CREATE POLICY "stock_logs_admin_read"
  ON stock_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
