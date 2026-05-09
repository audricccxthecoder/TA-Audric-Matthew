-- ============================================
-- 011_fn_commit_purchase_v2.sql
-- Pertemuan 12: extend fn_commit_purchase supaya bisa auto-create produk baru
-- saat OCR menemukan kode_barang yang belum ada di master barang.
--
-- Format payload p_items berubah: setiap item sekarang punya field "action":
--   action='restock' → pakai product_id yang sudah ada (kode_barang match di
--                      catalog). Field minimum: { action, product_id, qty,
--                      harga_beli, diskon_persen, source }.
--   action='new'     → kode_barang user tidak ada di catalog dan user pilih
--                      "Buat sebagai produk baru" di modal. Field minimum:
--                      { action, kode_barang, nama_barang, qty, harga_beli,
--                        diskon_persen, source }. Function akan INSERT INTO
--                      products (harga_jual=0, status='aktif', stok=0) lalu
--                      pakai product_id baru untuk INSERT purchase_items
--                      (trigger R4 yang menambah stok).
--
-- Race condition: kalau action='new' tapi kode_barang ternyata sudah ada
-- (mis. user lain baru saja menambah produk dengan kode sama), kita pakai
-- ON CONFLICT DO NOTHING + fallback SELECT untuk graceful merge ke produk
-- existing. Stok tetap bertambah (R4), tapi nama_barang yang user ketik
-- diabaikan (kode_barang adalah unique key).
-- ============================================

CREATE OR REPLACE FUNCTION fn_commit_purchase(
  p_user_id          UUID,
  p_no_nota_supplier VARCHAR(50),
  p_file_nota_url    TEXT,
  p_items            JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase_id  UUID;
  v_total        NUMERIC(14,2) := 0;
  v_item         JSONB;
  v_action       TEXT;
  v_product_id   UUID;
  v_kode_barang  VARCHAR(30);
  v_nama_barang  VARCHAR(150);
  v_qty          INTEGER;
  v_harga_beli   NUMERIC(12,2);
  v_diskon       NUMERIC(5,2);
  v_source       VARCHAR(20);
  v_n_created    INTEGER := 0;
BEGIN
  -- R3: izinkan trigger R4 melakukan UPDATE products.stok dalam transaksi ini
  PERFORM set_config('app.allow_stok_update', 'true', true);

  -- Hitung total: SUM(qty * harga_beli * (1 - diskon/100))
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty        := (v_item->>'qty')::INTEGER;
    v_harga_beli := (v_item->>'harga_beli')::NUMERIC;
    v_diskon     := COALESCE((v_item->>'diskon_persen')::NUMERIC, 0);
    v_total      := v_total + (v_qty * v_harga_beli * (1 - v_diskon / 100.0));
  END LOOP;

  -- INSERT header purchases
  INSERT INTO purchases (
    no_nota_supplier, user_id, total, status_validasi, file_nota_url
  ) VALUES (
    p_no_nota_supplier, p_user_id, v_total, 'tervalidasi', p_file_nota_url
  )
  RETURNING id INTO v_purchase_id;

  -- INSERT detail per item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_action     := COALESCE(v_item->>'action', 'restock');
    v_qty        := (v_item->>'qty')::INTEGER;
    v_harga_beli := (v_item->>'harga_beli')::NUMERIC;
    v_diskon     := COALESCE((v_item->>'diskon_persen')::NUMERIC, 0);
    v_source     := COALESCE(v_item->>'source', 'manual');

    IF v_action = 'new' THEN
      v_kode_barang := TRIM(v_item->>'kode_barang');
      v_nama_barang := TRIM(v_item->>'nama_barang');

      IF v_kode_barang IS NULL OR LENGTH(v_kode_barang) = 0 THEN
        RAISE EXCEPTION
          'fn_commit_purchase: action=new wajib menyertakan kode_barang';
      END IF;
      IF v_nama_barang IS NULL OR LENGTH(v_nama_barang) = 0 THEN
        RAISE EXCEPTION
          'fn_commit_purchase: action=new wajib menyertakan nama_barang';
      END IF;

      -- Coba INSERT produk baru dengan harga_jual=0 (admin update nanti di
      -- Master Barang). Stok awal 0; trigger R4 yang akan menambah qty.
      INSERT INTO products (
        kode_barang, nama_barang, harga_beli, harga_jual, status, stok
      ) VALUES (
        v_kode_barang, v_nama_barang, v_harga_beli, 0, 'aktif', 0
      )
      ON CONFLICT (kode_barang) DO NOTHING
      RETURNING id INTO v_product_id;

      IF v_product_id IS NULL THEN
        -- Race condition: kode sudah ada → graceful fallback ke produk existing.
        -- nama_barang yang user ketik diabaikan; kode_barang adalah unique key.
        SELECT id INTO v_product_id
          FROM products
         WHERE kode_barang = v_kode_barang
         LIMIT 1;
        IF v_product_id IS NULL THEN
          RAISE EXCEPTION
            'fn_commit_purchase: gagal create produk dengan kode "%"', v_kode_barang;
        END IF;
      ELSE
        v_n_created := v_n_created + 1;
      END IF;

    ELSE
      -- action = 'restock' → pakai product_id yang sudah dipilih user
      v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION
          'fn_commit_purchase: action=restock wajib menyertakan product_id';
      END IF;
    END IF;

    INSERT INTO purchase_items (
      purchase_id, product_id, qty, harga_beli, diskon_persen, source
    ) VALUES (
      v_purchase_id, v_product_id, v_qty, v_harga_beli, v_diskon, v_source
    );
    -- Trigger R4 (fn_purchase_items_apply) menambah products.stok dan tulis stock_logs ACCEPTED.
  END LOOP;

  RETURN jsonb_build_object(
    'purchase_id',      v_purchase_id,
    'no_nota_supplier', p_no_nota_supplier,
    'total',            v_total,
    'status_validasi',  'tervalidasi',
    'products_created', v_n_created
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_commit_purchase(UUID, VARCHAR, TEXT, JSONB) TO service_role;
