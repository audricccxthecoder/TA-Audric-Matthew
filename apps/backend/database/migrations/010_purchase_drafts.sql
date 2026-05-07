-- =================================================================
-- Migration 010 — purchase_drafts (Cross-device Draft Resume)
-- =================================================================
-- Untuk fitur "scan dari HP, edit di laptop": draft OCR yang belum
-- di-commit disimpan di tabel ini. User bisa list & resume dari device
-- manapun selama login dengan akun yang sama.
--
-- Catatan keamanan: payload disimpan sebagai JSONB. Tidak boleh berisi
-- data sensitif lain selain hasil parsing OCR + state validasi user.
-- =================================================================

CREATE TABLE IF NOT EXISTS purchase_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  no_nota_supplier TEXT,
  file_nota_url TEXT NOT NULL,
  nota_type TEXT,
  raw_text TEXT,
  preprocessing JSONB,
  quality JSONB,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_drafts_user_created
  ON purchase_drafts (user_id, created_at DESC);

-- Trigger: setiap UPDATE → updated_at = NOW()
CREATE OR REPLACE FUNCTION fn_purchase_drafts_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_drafts_touch ON purchase_drafts;
CREATE TRIGGER trg_purchase_drafts_touch
BEFORE UPDATE ON purchase_drafts
FOR EACH ROW EXECUTE FUNCTION fn_purchase_drafts_touch_updated_at();

-- RLS — user hanya bisa lihat draft milik sendiri
ALTER TABLE purchase_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_drafts_owner_select ON purchase_drafts;
CREATE POLICY purchase_drafts_owner_select
  ON purchase_drafts FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS purchase_drafts_owner_modify ON purchase_drafts;
CREATE POLICY purchase_drafts_owner_modify
  ON purchase_drafts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
