-- ============================================
-- 002_products.sql
-- Tabel master barang. Kolom `stok` dilindungi trigger R3 (lihat 006).
-- ============================================

CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kode_barang  VARCHAR(30)  NOT NULL UNIQUE,
  nama_barang  VARCHAR(150) NOT NULL,
  merk         VARCHAR(80),
  harga_beli   NUMERIC(12,2) NOT NULL DEFAULT 0,
  harga_jual   NUMERIC(12,2) NOT NULL DEFAULT 0,
  stok         INTEGER       NOT NULL DEFAULT 0,
  min_stock    INTEGER       NOT NULL DEFAULT 0,
  status       VARCHAR(20)   NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'nonaktif')),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_kode_barang ON products(kode_barang);
CREATE INDEX IF NOT EXISTS idx_products_nama_barang ON products(nama_barang);
CREATE INDEX IF NOT EXISTS idx_products_status      ON products(status);

-- Auto-update updated_at saat row diubah
CREATE OR REPLACE FUNCTION fn_products_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_touch_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION fn_products_touch_updated_at();

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_authenticated_read"
  ON products FOR SELECT USING (auth.uid() IS NOT NULL);

-- Tulis (insert/update) hanya via backend (service_role bypass RLS).
-- Tidak ada policy WITH CHECK untuk anon/authenticated.
