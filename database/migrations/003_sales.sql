-- ============================================
-- 003_sales.sql
-- Header & detail transaksi penjualan.
-- R1 (Pencegahan Stok Negatif) dijalankan di service layer SEBELUM INSERT.
-- R4 (Konsistensi Stok) dijalankan di trigger AFTER INSERT (lihat 006).
-- ============================================

CREATE TABLE IF NOT EXISTS sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kode_transaksi  VARCHAR(30) NOT NULL UNIQUE,
  user_id         UUID NOT NULL REFERENCES users(id),
  total_harga     NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_kode_transaksi ON sales(kode_transaksi);
CREATE INDEX IF NOT EXISTS idx_sales_created_at     ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_user_id        ON sales(user_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id        UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id),
  qty            INTEGER NOT NULL CHECK (qty > 0),
  harga_satuan   NUMERIC(12,2) NOT NULL,
  subtotal       NUMERIC(14,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id    ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);

ALTER TABLE sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_authenticated_read"
  ON sales FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "sale_items_authenticated_read"
  ON sale_items FOR SELECT USING (auth.uid() IS NOT NULL);
