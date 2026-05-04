-- ============================================
-- 010_view_R5_avg_sales.sql
-- Pertemuan 9: extend view R5 (Rekomendasi Restock) dengan kolom
-- avg_sales_30d = rata-rata kuantitas terjual per hari dalam 30 hari
-- terakhir. Dipakai halaman /admin/dashboard/restock untuk membantu
-- admin memutuskan jumlah restock yang masuk akal.
--
-- min_stock TETAP ditetapkan MANUAL oleh admin (laporan: BUKAN otomatis,
-- BUKAN Min-Max/EOQ/AI). Kolom avg_sales_30d hanya nilai informasi.
-- ============================================

DROP VIEW IF EXISTS v_restock_recommendation;

CREATE OR REPLACE VIEW v_restock_recommendation AS
WITH sales_30d AS (
  SELECT
    si.product_id,
    SUM(si.qty)::numeric / 30.0 AS avg_sales_30d,
    SUM(si.qty)                 AS total_sold_30d,
    COUNT(DISTINCT s.id)        AS n_transactions_30d
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  WHERE s.created_at >= NOW() - INTERVAL '30 days'
  GROUP BY si.product_id
)
SELECT
  p.id,
  p.kode_barang,
  p.nama_barang,
  p.merk,
  p.stok,
  p.min_stock,
  (p.min_stock - p.stok)                                  AS kekurangan,
  CASE
    WHEN p.stok = 0                  THEN 'HABIS'
    WHEN p.stok <= (p.min_stock / 2) THEN 'KRITIS'
    ELSE                                  'MENIPIS'
  END                                                     AS tingkat_urgensi,
  p.harga_beli,
  p.harga_jual,
  p.status,
  COALESCE(s30.avg_sales_30d, 0)::numeric(12,3) AS avg_sales_30d,
  COALESCE(s30.total_sold_30d, 0)               AS total_sold_30d,
  COALESCE(s30.n_transactions_30d, 0)           AS n_transactions_30d,
  -- Estimasi hari sebelum stok habis pada laju penjualan saat ini.
  -- NULL jika belum ada penjualan 30 hari (avg=0) → tidak bisa diestimasi.
  CASE
    WHEN COALESCE(s30.avg_sales_30d, 0) > 0
      THEN (p.stok / s30.avg_sales_30d)::numeric(10,1)
    ELSE NULL
  END                                                     AS estimasi_hari_habis
FROM products p
LEFT JOIN sales_30d s30 ON s30.product_id = p.id
WHERE p.status = 'aktif'
  AND p.stok  <= p.min_stock
ORDER BY
  (CASE WHEN p.stok = 0 THEN 0
        WHEN p.stok <= (p.min_stock / 2) THEN 1
        ELSE 2 END),
  (p.min_stock - p.stok) DESC;

COMMENT ON VIEW v_restock_recommendation IS
  'R5 — Rekomendasi Restock. Memuat barang aktif dengan stok <= min_stock, '
  'plus rata-rata penjualan 30 hari sebagai bahan keputusan admin. '
  'min_stock di-set MANUAL oleh admin via PATCH /api/products/:id.';
