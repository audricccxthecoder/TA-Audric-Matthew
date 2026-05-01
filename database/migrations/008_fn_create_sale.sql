-- ============================================
-- 008_fn_create_sale.sql
-- Wrapper transaksi atomik untuk POST /api/sales.
--
-- Alasan: supabase-js tidak bisa menjalankan BEGIN/COMMIT lintas HTTP request,
-- jadi seluruh alur INSERT sales -> INSERT sale_items dijalankan dalam SATU
-- function plpgsql. Function plpgsql berjalan di dalam satu transaksi implisit:
-- jika ada RAISE EXCEPTION (R1 trigger atau R3 trigger) maka SELURUH perubahan
-- otomatis ROLLBACK.
--
-- Service layer (Layer 1 R1) sudah pre-check stok sebelum memanggil function ini.
-- Function ini juga menjalankan SET LOCAL app.allow_stok_update = 'true' supaya
-- trigger R3 (BEFORE UPDATE products) mengizinkan UPDATE stok yang dilakukan
-- oleh trigger R4 (AFTER INSERT sale_items).
-- ============================================

CREATE OR REPLACE FUNCTION fn_create_sale(
  p_user_id        UUID,
  p_kode_transaksi VARCHAR(30),
  p_items          JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_id      UUID;
  v_total        NUMERIC(14,2) := 0;
  v_item         JSONB;
  v_product_id   UUID;
  v_qty          INTEGER;
  v_harga_satuan NUMERIC(12,2);
  v_subtotal     NUMERIC(14,2);
BEGIN
  -- R3: izinkan trigger R4 melakukan UPDATE products.stok dalam transaksi ini
  PERFORM set_config('app.allow_stok_update', 'true', true);

  -- Hitung total dulu supaya bisa di-INSERT bersama header
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty          := (v_item->>'qty')::INTEGER;
    v_harga_satuan := (v_item->>'harga_satuan')::NUMERIC;
    v_total := v_total + (v_qty * v_harga_satuan);
  END LOOP;

  -- INSERT header sales
  INSERT INTO sales (kode_transaksi, user_id, total_harga)
  VALUES (p_kode_transaksi, p_user_id, v_total)
  RETURNING id INTO v_sale_id;

  -- INSERT detail sale_items (trigger R1 BEFORE INSERT akan re-check stok,
  -- trigger R4 AFTER INSERT akan decrement products.stok + tulis stock_logs)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id   := (v_item->>'product_id')::UUID;
    v_qty          := (v_item->>'qty')::INTEGER;
    v_harga_satuan := (v_item->>'harga_satuan')::NUMERIC;
    v_subtotal     := v_qty * v_harga_satuan;

    INSERT INTO sale_items (sale_id, product_id, qty, harga_satuan, subtotal)
    VALUES (v_sale_id, v_product_id, v_qty, v_harga_satuan, v_subtotal);
  END LOOP;

  RETURN jsonb_build_object(
    'sale_id',        v_sale_id,
    'kode_transaksi', p_kode_transaksi,
    'total_harga',    v_total
  );
END;
$$;

-- Service role memanggil function ini via supabase.rpc() — RLS sudah dilewati.
GRANT EXECUTE ON FUNCTION fn_create_sale(UUID, VARCHAR, JSONB) TO service_role;
