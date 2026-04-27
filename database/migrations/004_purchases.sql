-- ============================================
-- 004_purchases.sql
-- Header & detail pembelian dari supplier (input via OCR / manual).
-- R2 (Validasi Stok Masuk) dievaluasi di service layer SEBELUM INSERT purchase_items.
-- R4 (Konsistensi Stok) dijalankan di trigger AFTER INSERT (lihat 006).
-- ============================================

CREATE TABLE IF NOT EXISTS purchases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  no_nota_supplier  VARCHAR(50),
  user_id           UUID NOT NULL REFERENCES users(id),
  total             NUMERIC(14,2) NOT NULL DEFAULT 0,
  status_validasi   VARCHAR(20)   NOT NULL DEFAULT 'pending'
                    CHECK (status_validasi IN ('pending', 'tervalidasi')),
  file_nota_url     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchases_created_at      ON purchases(created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_status_validasi ON purchases(status_validasi);
CREATE INDEX IF NOT EXISTS idx_purchases_user_id         ON purchases(user_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id     UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  harga_beli      NUMERIC(12,2) NOT NULL,
  diskon_persen   NUMERIC(5,2) NOT NULL DEFAULT 0,
  source          VARCHAR(20) NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('ocr', 'manual')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id  ON purchase_items(product_id);

ALTER TABLE purchases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchases_authenticated_read"
  ON purchases FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "purchase_items_authenticated_read"
  ON purchase_items FOR SELECT USING (auth.uid() IS NOT NULL);
