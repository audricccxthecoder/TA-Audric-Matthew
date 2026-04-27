-- ============================================
-- 007_view_R5.sql
-- R5 — Rekomendasi Restock (read-only rule)
-- View dipakai endpoint GET /api/restock.
-- min_stock ditetapkan MANUAL oleh admin via PATCH /api/products/:id.
-- ============================================

CREATE OR REPLACE VIEW v_restock_recommendation AS
SELECT
  id,
  kode_barang,
  nama_barang,
  merk,
  stok,
  min_stock,
  (min_stock - stok)                                      AS kekurangan,
  CASE
    WHEN stok = 0                THEN 'HABIS'
    WHEN stok <= (min_stock / 2) THEN 'KRITIS'
    ELSE                              'MENIPIS'
  END                                                     AS tingkat_urgensi,
  harga_beli,
  harga_jual,
  status
FROM products
WHERE status = 'aktif'
  AND stok  <= min_stock
ORDER BY
  (CASE WHEN stok = 0 THEN 0
        WHEN stok <= (min_stock / 2) THEN 1
        ELSE 2 END),
  (min_stock - stok) DESC;

-- View tidak butuh RLS terpisah karena ia turun dari RLS tabel products
-- (atau dipanggil via service_role yang bypass RLS).
