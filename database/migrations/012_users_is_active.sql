-- ============================================
-- 012_users_is_active.sql
-- Pertemuan 13: User Management — soft deactivate
-- ============================================
-- Sebelumnya kolom status user belum ada. Untuk menonaktifkan akun
-- (Fase 5.1 CLAUDE.md) tanpa kehilangan FK referensi (audit_trail,
-- sales.user_id, dst), kita pakai soft-flag `is_active`.
--
-- authMiddleware akan menolak user dengan is_active=false (HTTP 401),
-- jadi sesi yang sudah login pun langsung kehilangan akses begitu admin
-- menonaktifkannya (di-cek tiap request).
-- ============================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
