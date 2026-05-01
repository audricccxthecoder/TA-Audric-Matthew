# Test Scenarios — POST /api/sales (R1, R3, R4)

> Pertemuan 7 — Modul Transaksi Penjualan
> Setiap skenario dijalankan terhadap backend yang menyala (`npm run dev` di `apps/backend`) dan database Supabase terisi seed minimal:
> - 1 user role `kasir` (login terlebih dahulu, simpan `ACCESS_TOKEN`)
> - Produk demo `kode_barang='SCM-001'` dengan `stok=10`, `harga_jual=15000`, `status='aktif'`

```bash
ACCESS_TOKEN="<JWT dari POST /api/auth/login>"
PROD_ID="<UUID dari produk SCM-001>"
```

---

## Skenario 1 — Stok cukup (happy path, R4 ACCEPTED)

**Tujuan:** Buktikan transaksi berhasil, stok berkurang, audit `R4 ACCEPTED` tercatat.

```bash
curl -X POST http://localhost:5000/api/sales \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"items\": [
      { \"product_id\": \"$PROD_ID\", \"qty\": 3, \"harga_satuan\": 15000 }
    ]
  }"
```

**Expected response:** HTTP `201`
```json
{
  "message": "Transaksi berhasil",
  "data": {
    "kode_transaksi": "INV-20260428-XXXXXX",
    "total_harga": 45000,
    "items": [{ "qty": 3, "subtotal": 45000, "nama_barang": "..." }]
  }
}
```

**Verifikasi di DB:**
```sql
-- Stok berkurang persis 3
SELECT stok FROM products WHERE id = '<PROD_ID>';     -- harus 7

-- Audit R4 ACCEPTED tercatat (ditulis oleh trigger fn_sale_items_apply)
SELECT rule_triggered, rule_action, delta_qty, stok_sebelum, stok_sesudah, reason_detail
  FROM stock_logs
  WHERE product_id = '<PROD_ID>'
  ORDER BY created_at DESC
  LIMIT 1;
-- rule_triggered='R4', rule_action='ACCEPTED', delta_qty=-3, stok_sebelum=10, stok_sesudah=7
```

---

## Skenario 2 — Stok tidak cukup (R1 REJECTED, HTTP 409)

**Tujuan:** Buktikan transaksi ditolak DI LUAR DB (Layer 1 service), stok TIDAK berubah, audit `R1 REJECTED` tercatat.

> Reset stok produk ke 10 dulu (lihat skenario 1 → stok sekarang 7, pakai 99 supaya pasti tolak):

```bash
curl -X POST http://localhost:5000/api/sales \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"items\": [
      { \"product_id\": \"$PROD_ID\", \"qty\": 99, \"harga_satuan\": 15000 }
    ]
  }"
```

**Expected response:** HTTP `409`
```json
{
  "error": "Stok tidak mencukupi untuk \"Suku Cadang Motor 001\": request 99 unit, tersedia 7 unit",
  "rule": "R1",
  "failures": [
    {
      "product_id": "...",
      "stok_tersedia": 7,
      "qty_diminta": 99,
      "reason": "Stok tidak mencukupi untuk \"Suku Cadang Motor 001\": request 99 unit, tersedia 7 unit"
    }
  ]
}
```

**Verifikasi di DB:**
```sql
-- Stok TIDAK BERUBAH
SELECT stok FROM products WHERE id = '<PROD_ID>';     -- masih 7

-- Audit R1 REJECTED tercatat
SELECT rule_triggered, rule_action, reason_detail, context_payload
  FROM stock_logs
  WHERE product_id = '<PROD_ID>' AND rule_action = 'REJECTED'
  ORDER BY created_at DESC
  LIMIT 1;
-- rule_triggered='R1', rule_action='REJECTED'

-- Tidak ada baris baru di sales / sale_items
SELECT COUNT(*) FROM sales WHERE created_at > NOW() - INTERVAL '1 minute';  -- 0
```

---

## Skenario 3 — Rollback otomatis (R3 melindungi UPDATE liar)

**Tujuan:** Buktikan jika ada upaya UPDATE products.stok dari jalur tidak resmi, R3 trigger akan RAISE EXCEPTION dan SELURUH transaksi di-ROLLBACK.

**3a. Simulasi langsung di SQL editor Supabase** (menyamai serangan / bug di service layer):
```sql
-- Tanpa SET LOCAL app.allow_stok_update, R3 harus menolak:
UPDATE products SET stok = 9999 WHERE id = '<PROD_ID>';
-- ERROR: 45R03 — R3: products.stok tidak boleh diubah langsung. Old=7, New=9999.
```

**3b. Verifikasi rollback di endpoint:** karena `fn_create_sale` memanggil `set_config('app.allow_stok_update', 'true', true)` HANYA di scope transaksinya, request lain tidak terpengaruh. Untuk mensimulasikan failure mid-transaction, hentikan server (Ctrl+C) tepat saat fase INSERT sale_items berjalan, lalu cek:

```sql
-- Tidak boleh ada sale_items orphan tanpa header sales
SELECT si.* FROM sale_items si
  LEFT JOIN sales s ON s.id = si.sale_id
  WHERE s.id IS NULL;          -- harus 0 baris

-- Tidak boleh ada perubahan stok untuk transaksi yang batal
SELECT delta_qty, stok_sesudah FROM stock_logs
  WHERE created_at > NOW() - INTERVAL '5 minutes'
    AND rule_action = 'ACCEPTED';
-- hanya transaksi yang COMMIT yang muncul
```

**3c. Tes paling simpel via curl** (kirim 2 item, item kedua product_id sengaja salah/tidak ada):
```bash
curl -X POST http://localhost:5000/api/sales \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"items\": [
      { \"product_id\": \"$PROD_ID\",                                \"qty\": 1, \"harga_satuan\": 15000 },
      { \"product_id\": \"00000000-0000-0000-0000-000000000000\",     \"qty\": 1, \"harga_satuan\": 15000 }
    ]
  }"
```

**Expected:** HTTP `409` dengan `rule="R1"` (item kedua gagal pre-check) — TANPA mengurangi stok item pertama. Verifikasi:
```sql
SELECT stok FROM products WHERE id = '<PROD_ID>';      -- masih 7, item pertama TIDAK ter-decrement
```

---

## Ringkasan defense-in-depth yang sudah terbukti

| Lapisan | R1 (Stok Negatif) | R3 (UPDATE liar) | R4 (Konsistensi) |
|---|---|---|---|
| Service layer (Express) | Pre-check + log REJECTED + HTTP 409 | (tidak ada UPDATE manual) | Delegasi ke trigger |
| Database (PostgreSQL) | Trigger `fn_sale_items_check_r1` (BEFORE INSERT, FOR UPDATE) | Trigger `fn_products_stok_guard` (BEFORE UPDATE) | Trigger `fn_sale_items_apply` (AFTER INSERT) decrement + log ACCEPTED |
| Audit trail (`stock_logs`) | REJECTED ditulis service layer | TRIGGERED ditulis service layer saat exception | ACCEPTED ditulis trigger DB |
