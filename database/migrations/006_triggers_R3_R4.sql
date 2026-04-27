-- ============================================
-- 006_triggers_R3_R4.sql
-- LAPISAN 2 (database) untuk Rule-Based System.
--
-- Catatan tentang audit log saat trigger menolak:
--   Ketika trigger memanggil RAISE EXCEPTION, transaksi di-ROLLBACK termasuk
--   INSERT ke stock_logs di dalam trigger itu sendiri. Karena itu, untuk
--   penolakan (rule_action='REJECTED') AUDIT WAJIB ditulis dari SERVICE LAYER
--   sebelum statement pemicu — bukan dari trigger.
--   Trigger di sini hanya memblokir; service layer mencatat alasan REJECTED.
--   Untuk ACCEPTED (UPDATE berhasil), trigger AMAN menulis log karena commit.
-- ============================================

-- --------------------------------------------
-- R3 — Pembaruan Stok Terpusat
-- BEFORE UPDATE pada products: tolak perubahan stok jika app.allow_stok_update != 'true'
-- --------------------------------------------
CREATE OR REPLACE FUNCTION fn_products_stok_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_allow TEXT;
BEGIN
  IF OLD.stok IS DISTINCT FROM NEW.stok THEN
    v_allow := current_setting('app.allow_stok_update', true);
    IF v_allow IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION
        'R3: products.stok tidak boleh diubah langsung. Old=%, New=%. Gunakan transaksi penjualan atau stok masuk tervalidasi.',
        OLD.stok, NEW.stok
        USING ERRCODE = '45R03';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_stok_guard ON products;
CREATE TRIGGER trg_products_stok_guard
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION fn_products_stok_guard();


-- --------------------------------------------
-- R1 LAYER 2 — Pencegahan Stok Negatif (re-check di DB)
-- BEFORE INSERT pada sale_items: tolak jika stok < qty
-- (R1 LAYER 1 sudah dijalankan di service layer; ini defense-in-depth)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION fn_sale_items_check_r1()
RETURNS TRIGGER AS $$
DECLARE
  v_stok INTEGER;
  v_nama VARCHAR(150);
BEGIN
  SELECT stok, nama_barang INTO v_stok, v_nama
    FROM products WHERE id = NEW.product_id FOR UPDATE;

  IF v_stok IS NULL THEN
    RAISE EXCEPTION 'R1: Produk % tidak ditemukan', NEW.product_id
      USING ERRCODE = '45R01';
  END IF;

  IF v_stok < NEW.qty THEN
    RAISE EXCEPTION
      'R1: Stok tidak mencukupi untuk "%": request % unit, tersedia % unit',
      v_nama, NEW.qty, v_stok
      USING ERRCODE = '45R01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sale_items_check_r1 ON sale_items;
CREATE TRIGGER trg_sale_items_check_r1
  BEFORE INSERT ON sale_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_sale_items_check_r1();


-- --------------------------------------------
-- R4 — Konsistensi Stok untuk Penjualan
-- AFTER INSERT pada sale_items: kurangi stok + log ACCEPTED
-- --------------------------------------------
CREATE OR REPLACE FUNCTION fn_sale_items_apply()
RETURNS TRIGGER AS $$
DECLARE
  v_stok_sebelum INTEGER;
  v_stok_sesudah INTEGER;
  v_user_id      UUID;
  v_kode_trx     VARCHAR(30);
BEGIN
  SELECT user_id, kode_transaksi INTO v_user_id, v_kode_trx
    FROM sales WHERE id = NEW.sale_id;

  SELECT stok INTO v_stok_sebelum
    FROM products WHERE id = NEW.product_id FOR UPDATE;

  -- R4: izinkan UPDATE products.stok dalam transaksi ini saja
  PERFORM set_config('app.allow_stok_update', 'true', true);

  UPDATE products SET stok = stok - NEW.qty WHERE id = NEW.product_id;
  v_stok_sesudah := v_stok_sebelum - NEW.qty;

  INSERT INTO stock_logs (
    product_id, user_id, delta_qty, stok_sebelum, stok_sesudah,
    source_type, rule_triggered, rule_action, reason_detail, context_payload
  ) VALUES (
    NEW.product_id, v_user_id, -NEW.qty, v_stok_sebelum, v_stok_sesudah,
    'sales', 'R4', 'ACCEPTED',
    format('Stok dikurangi %s unit dari penjualan %s', NEW.qty, v_kode_trx),
    jsonb_build_object(
      'sale_item_id', NEW.id,
      'sale_id',      NEW.sale_id,
      'kode_trx',     v_kode_trx,
      'qty',          NEW.qty,
      'harga_satuan', NEW.harga_satuan
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sale_items_apply ON sale_items;
CREATE TRIGGER trg_sale_items_apply
  AFTER INSERT ON sale_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_sale_items_apply();


-- --------------------------------------------
-- R4 — Konsistensi Stok untuk Pembelian
-- AFTER INSERT pada purchase_items: tambah stok + log ACCEPTED
-- (R2 dijaga di service layer: purchase_items hanya di-INSERT setelah
--  user mengkonfirmasi & purchases.status_validasi = 'tervalidasi')
-- --------------------------------------------
CREATE OR REPLACE FUNCTION fn_purchase_items_apply()
RETURNS TRIGGER AS $$
DECLARE
  v_stok_sebelum INTEGER;
  v_stok_sesudah INTEGER;
  v_user_id      UUID;
  v_no_nota      VARCHAR(50);
BEGIN
  SELECT user_id, no_nota_supplier INTO v_user_id, v_no_nota
    FROM purchases WHERE id = NEW.purchase_id;

  SELECT stok INTO v_stok_sebelum
    FROM products WHERE id = NEW.product_id FOR UPDATE;

  -- R4: izinkan UPDATE products.stok dalam transaksi ini saja
  PERFORM set_config('app.allow_stok_update', 'true', true);

  UPDATE products SET stok = stok + NEW.qty WHERE id = NEW.product_id;
  v_stok_sesudah := v_stok_sebelum + NEW.qty;

  INSERT INTO stock_logs (
    product_id, user_id, delta_qty, stok_sebelum, stok_sesudah,
    source_type, rule_triggered, rule_action, reason_detail, context_payload
  ) VALUES (
    NEW.product_id, v_user_id, NEW.qty, v_stok_sebelum, v_stok_sesudah,
    'purchase', 'R4', 'ACCEPTED',
    format('Stok ditambah %s unit dari pembelian nota %s', NEW.qty, COALESCE(v_no_nota, '(tanpa nota)')),
    jsonb_build_object(
      'purchase_item_id', NEW.id,
      'purchase_id',      NEW.purchase_id,
      'no_nota',          v_no_nota,
      'qty',              NEW.qty,
      'harga_beli',       NEW.harga_beli,
      'diskon_persen',    NEW.diskon_persen,
      'source',           NEW.source
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_items_apply ON purchase_items;
CREATE TRIGGER trg_purchase_items_apply
  AFTER INSERT ON purchase_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_purchase_items_apply();
