-- ============================================
-- POS System — CV Asia Jaya Maju
-- Initial Database Schema Migration
-- ============================================

-- ENUM types
CREATE TYPE user_role AS ENUM ('admin', 'kasir');
CREATE TYPE product_status AS ENUM ('active', 'inactive');

-- ============================================
-- TABLES
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'kasir',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kode_barang VARCHAR(50) NOT NULL UNIQUE,
  nama_barang VARCHAR(255) NOT NULL,
  merk VARCHAR(100),
  harga_beli NUMERIC(12,2) NOT NULL DEFAULT 0,
  harga_jual NUMERIC(12,2) NOT NULL DEFAULT 0,
  stok INTEGER NOT NULL DEFAULT 0,
  min_stok INTEGER NOT NULL DEFAULT 5,
  status product_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kode_transaksi VARCHAR(50) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  harga_jual NUMERIC(12,2) NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stock_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name VARCHAR(255) NOT NULL,
  nota_file_url TEXT,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  user_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stock_in_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_in_id UUID NOT NULL REFERENCES stock_ins(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  qty INTEGER NOT NULL DEFAULT 0,
  harga_beli NUMERIC(12,2) NOT NULL DEFAULT 0,
  diskon_persen NUMERIC(5,2) NOT NULL DEFAULT 0,
  validated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  table_name VARCHAR(100) NOT NULL,
  record_id UUID,
  old_value JSONB,
  new_value JSONB,
  rule_triggered VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_products_kode_barang ON products(kode_barang);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_nama_barang ON products(nama_barang);
CREATE INDEX idx_transactions_kode_transaksi ON transactions(kode_transaksi);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transaction_items_transaction_id ON transaction_items(transaction_id);
CREATE INDEX idx_transaction_items_product_id ON transaction_items(product_id);
CREATE INDEX idx_stock_ins_created_at ON stock_ins(created_at);
CREATE INDEX idx_stock_in_items_stock_in_id ON stock_in_items(stock_in_id);
CREATE INDEX idx_audit_trail_created_at ON audit_trail(created_at);
CREATE INDEX idx_audit_trail_table_name ON audit_trail(table_name);
CREATE INDEX idx_audit_trail_user_id ON audit_trail(user_id);

-- ============================================
-- TRIGGER: auto update updated_at on products
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- TRIGGER: reduce stock on transaction_items INSERT
-- ============================================

CREATE OR REPLACE FUNCTION reduce_stock_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
  SET stok = stok - NEW.qty
  WHERE id = NEW.product_id;

  INSERT INTO audit_trail (user_id, action, table_name, record_id, old_value, new_value, rule_triggered)
  SELECT
    t.user_id,
    'stock_decrease',
    'products',
    NEW.product_id,
    jsonb_build_object('stok', p.stok + NEW.qty),
    jsonb_build_object('stok', p.stok),
    'Centralized Stock Update — sale transaction'
  FROM transactions t, products p
  WHERE t.id = NEW.transaction_id AND p.id = NEW.product_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_reduce_stock_on_sale
  AFTER INSERT ON transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION reduce_stock_on_sale();

-- ============================================
-- TRIGGER: increase stock on validated stock_in_items
-- ============================================

CREATE OR REPLACE FUNCTION increase_stock_on_stock_in()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.validated = TRUE AND (OLD IS NULL OR OLD.validated = FALSE) THEN
    UPDATE products
    SET stok = stok + NEW.qty
    WHERE id = NEW.product_id;

    INSERT INTO audit_trail (user_id, action, table_name, record_id, old_value, new_value, rule_triggered)
    SELECT
      si.user_id,
      'stock_increase',
      'products',
      NEW.product_id,
      jsonb_build_object('stok', p.stok - NEW.qty),
      jsonb_build_object('stok', p.stok),
      'Centralized Stock Update — validated stock in'
    FROM stock_ins si, products p
    WHERE si.id = NEW.stock_in_id AND p.id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_increase_stock_on_stock_in
  AFTER INSERT OR UPDATE ON stock_in_items
  FOR EACH ROW
  EXECUTE FUNCTION increase_stock_on_stock_in();

-- ============================================
-- TRIGGER: prevent direct stock update on products
-- ============================================

CREATE OR REPLACE FUNCTION prevent_direct_stock_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.stok IS DISTINCT FROM NEW.stok THEN
    IF current_setting('app.allow_stock_update', TRUE) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Stok tidak boleh diubah langsung. Gunakan transaksi penjualan atau stok masuk.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_direct_stock_update
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_direct_stock_update();

-- Allow the stock update triggers to bypass the direct update prevention
-- by setting a session variable before updating
ALTER FUNCTION reduce_stock_on_sale() SET app.allow_stock_update = 'true';
ALTER FUNCTION increase_stock_on_stock_in() SET app.allow_stock_update = 'true';

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_in_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;

-- Users: can read own profile, admin can read all
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admin can view all users"
  ON users FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can insert users"
  ON users FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can update users"
  ON users FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Products: all authenticated users can read, admin and kasir can insert/update
CREATE POLICY "Authenticated users can view products"
  ON products FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert products"
  ON products FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update products"
  ON products FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Transactions: all authenticated users can read, kasir/admin can insert
CREATE POLICY "Authenticated users can view transactions"
  ON transactions FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert transactions"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Transaction items: follow transaction access
CREATE POLICY "Authenticated users can view transaction items"
  ON transaction_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert transaction items"
  ON transaction_items FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Stock ins: all authenticated users can access
CREATE POLICY "Authenticated users can view stock ins"
  ON stock_ins FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert stock ins"
  ON stock_ins FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update stock ins"
  ON stock_ins FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Stock in items: follow stock_ins access
CREATE POLICY "Authenticated users can view stock in items"
  ON stock_in_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert stock in items"
  ON stock_in_items FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update stock in items"
  ON stock_in_items FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Audit trail: admin can view all, kasir can view own
CREATE POLICY "Admin can view all audit trail"
  ON audit_trail FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can view own audit trail"
  ON audit_trail FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "System can insert audit trail"
  ON audit_trail FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Service role bypasses RLS, so backend with service_role key has full access
