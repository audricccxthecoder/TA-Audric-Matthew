-- ============================================
-- 001_users.sql
-- Tabel users — profil aplikasi (auth.users dikelola Supabase)
-- ============================================
-- Catatan: password TIDAK disimpan di tabel ini. Supabase Auth (auth.users)
-- yang menyimpan & memverifikasi password. JWT-nya diverifikasi via JWKS.

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    VARCHAR(50)  NOT NULL UNIQUE,
  role        VARCHAR(20)  NOT NULL CHECK (role IN ('admin', 'kasir')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- RLS: profil hanya dibaca oleh user sendiri atau admin (service_role bypass otomatis)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_self_read"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users_admin_read_all"
  ON users FOR SELECT
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
