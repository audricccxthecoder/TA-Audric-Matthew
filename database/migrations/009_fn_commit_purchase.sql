-- ============================================
-- 009_fn_commit_purchase.sql
-- Wrapper transaksi atomik untuk POST /api/purchases/commit.
--
-- Sama seperti fn_create_sale (lihat 008): seluruh INSERT purchases ->
-- INSERT purchase_items dijalankan dalam SATU function plpgsql, sehingga
-- jika ada RAISE EXCEPTION (R3 trigger / R4 trigger) seluruh perubahan
-- otomatis ROLLBACK.
--
-- Service layer (Layer 1 R2) sudah memvalidasi bahwa user mengkonfirmasi
-- (status_validasi='tervalidasi') sebelum memanggil function ini.
-- Function ini menjalankan SET LOCAL app.allow_stok_update='true' supaya
-- trigger R3 (BEFORE UPDATE products) mengizinkan UPDATE stok yang dilakukan
-- oleh trigger R4 (AFTER INSERT purchase_items, lihat 006).
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
  v_product_id   UUID;
  v_qty          INTEGER;
  v_harga_beli   NUMERIC(12,2);
  v_diskon       NUMERIC(5,2);
  v_source       VARCHAR(20);
  v_subtotal     NUMERIC(14,2);
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

  -- INSERT header purchases dengan status_validasi='tervalidasi' (R2 sudah lolos)
  INSERT INTO purchases (
    no_nota_supplier, user_id, total, status_validasi, file_nota_url
  ) VALUES (
    p_no_nota_supplier, p_user_id, v_total, 'tervalidasi', p_file_nota_url
  )
  RETURNING id INTO v_purchase_id;

  -- INSERT detail purchase_items
  -- Trigger R4 (fn_purchase_items_apply) akan menambah products.stok + tulis stock_logs
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_qty        := (v_item->>'qty')::INTEGER;
    v_harga_beli := (v_item->>'harga_beli')::NUMERIC;
    v_diskon     := COALESCE((v_item->>'diskon_persen')::NUMERIC, 0);
    v_source     := COALESCE(v_item->>'source', 'manual');

    INSERT INTO purchase_items (
      purchase_id, product_id, qty, harga_beli, diskon_persen, source
    ) VALUES (
      v_purchase_id, v_product_id, v_qty, v_harga_beli, v_diskon, v_source
    );
  END LOOP;

  RETURN jsonb_build_object(
    'purchase_id',      v_purchase_id,
    'no_nota_supplier', p_no_nota_supplier,
    'total',            v_total,
    'status_validasi',  'tervalidasi'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_commit_purchase(UUID, VARCHAR, TEXT, JSONB) TO service_role;
