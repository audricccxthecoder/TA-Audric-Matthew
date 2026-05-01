# Test Scenarios — POST /api/purchases/ocr & /api/purchases/commit (R2, R4)

> Pertemuan 8 — Modul Stok Masuk (Nota Cetak Komputer) + Levenshtein + R2
>
> Prasyarat:
>
> 1. Backend menyala (`npm run dev` di `apps/backend`)
> 2. Migrasi 001-009 sudah dijalankan di Supabase
> 3. Bucket Storage `nota-supplier` sudah dibuat di Supabase (private)
> 4. Seed produk minimal:
>    - `SCM-001` Kampas Rem Beat, `harga_beli=18000`, `stok=10`, `status='aktif'`
>    - `SCM-002` Oli Mesin 1L, `harga_beli=42000`, `stok=5`, `status='aktif'`
> 5. Login user role kasir, simpan `ACCESS_TOKEN`
> 6. Siapkan file nota uji `nota_cetak.jpg` (foto/scan nota cetak komputer)

```bash
ACCESS_TOKEN="<JWT dari POST /api/auth/login>"
PROD_SCM001="<UUID dari SCM-001>"
PROD_SCM002="<UUID dari SCM-002>"
```

---

## Skenario 1 — OCR happy path (file diterima → draft tampil)

**Tujuan:** Buktikan endpoint `/ocr` menerima file image, menjalankan preprocessing (Otsu + median blur), recognize via tesseract, dan mengembalikan kandidat top-3 per item via Levenshtein.

```bash
curl -X POST http://localhost:5000/api/purchases/ocr \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "file=@./nota_cetak.jpg" \
  -F "no_nota_supplier=INV-DEMO-001"
```

**Expected response:** HTTP `200`

```json
{
  "message": "OCR berhasil — silakan validasi hasil sebelum simpan",
  "data": {
    "status": "unsaved",
    "file_nota_url": "<user_id>/<ts>-xxxx.jpg",
    "file_nota_signed_url": "https://...supabase.co/storage/v1/object/sign/...",
    "no_nota_supplier": "INV-DEMO-001",
    "raw_text": "Kampas Rem Beat ...",
    "preprocessing": { "otsu_threshold": 127, "width": 1024, "height": 1536 },
    "items": [
      {
        "raw": { "kode_barang": "SCM-001", "nama_barang": "Kampas Rem Beat", "qty": 3, "harga_beli": 18000, "diskon_persen": 0 },
        "confidence": { "kode_barang": 88, "nama_barang": 91, "qty": 95, "harga_beli": 92, "diskon_persen": 0 },
        "confidence_avg": 91,
        "low_confidence": false,
        "candidates": [
          { "product_id": "<PROD_SCM001>", "kode_barang": "SCM-001", "nama_barang": "Kampas Rem Beat", "similarity": 1 },
          { "product_id": "<PROD_SCM002>", "kode_barang": "SCM-002", "nama_barang": "Oli Mesin 1L", "similarity": 0.13 }
        ]
      }
    ]
  }
}
```

**Verifikasi di DB:**

```sql
-- BELUM ada baris di purchases / purchase_items (commit-only DB write, status='unsaved')
SELECT COUNT(*) FROM purchases WHERE created_at > NOW() - INTERVAL '1 minute';      -- 0
SELECT COUNT(*) FROM purchase_items WHERE created_at > NOW() - INTERVAL '1 minute'; -- 0
```

File terupload di bucket `nota-supplier` (cek di Supabase dashboard).

---

## Skenario 2 — Commit happy path (R2 lolos, R4 ACCEPTED, stok bertambah)

**Tujuan:** Buktikan POST `/commit` dengan payload tervalidasi → stok bertambah persis qty, audit `R4 ACCEPTED` tercatat oleh trigger.

> Catat stok awal: `SELECT stok FROM products WHERE id='<PROD_SCM001>';` (anggap = 10)

```bash
curl -X POST http://localhost:5000/api/purchases/commit \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"no_nota_supplier\": \"INV-DEMO-001\",
    \"file_nota_url\": \"<file_nota_url dari skenario 1>\",
    \"status_validasi\": \"tervalidasi\",
    \"items\": [
      { \"product_id\": \"$PROD_SCM001\", \"qty\": 5, \"harga_beli\": 18000, \"diskon_persen\": 0, \"source\": \"ocr\" },
      { \"product_id\": \"$PROD_SCM002\", \"qty\": 2, \"harga_beli\": 42000, \"diskon_persen\": 10, \"source\": \"ocr\" }
    ]
  }"
```

**Expected response:** HTTP `201`

```json
{
  "message": "Stok masuk berhasil disimpan",
  "data": {
    "id": "...",
    "no_nota_supplier": "INV-DEMO-001",
    "total": 165600,
    "status_validasi": "tervalidasi",
    "items": [
      { "kode_barang": "SCM-001", "qty": 5, "harga_beli": 18000, "diskon_persen": 0 },
      { "kode_barang": "SCM-002", "qty": 2, "harga_beli": 42000, "diskon_persen": 10 }
    ]
  }
}
```

**Verifikasi di DB:**

```sql
-- Stok bertambah persis
SELECT stok FROM products WHERE id = '<PROD_SCM001>';   -- 10 + 5 = 15
SELECT stok FROM products WHERE id = '<PROD_SCM002>';   -- 5 + 2 = 7

-- Audit R4 ACCEPTED tercatat oleh trigger fn_purchase_items_apply
SELECT rule_triggered, rule_action, delta_qty, stok_sebelum, stok_sesudah
  FROM stock_logs
  WHERE source_type = 'purchase'
  ORDER BY created_at DESC
  LIMIT 2;
-- ('R4','ACCEPTED', 2, 5, 7) dan ('R4','ACCEPTED', 5, 10, 15)
```

---

## Skenario 3 — R2 REJECTED (manipulasi payload tanpa validasi user)

**Tujuan:** Buktikan endpoint `/commit` menolak payload yang `status_validasi != 'tervalidasi'` — ini simulasi serangan / bug client yang skip tombol Konfirmasi.

```bash
curl -X POST http://localhost:5000/api/purchases/commit \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"no_nota_supplier\": \"HACK-001\",
    \"file_nota_url\": \"hacked/path.jpg\",
    \"status_validasi\": \"pending\",
    \"items\": [
      { \"product_id\": \"$PROD_SCM001\", \"qty\": 999, \"harga_beli\": 1, \"diskon_persen\": 0, \"source\": \"manual\" }
    ]
  }"
```

**Expected response:** HTTP `400`

```json
{
  "error": "R2: stok masuk belum dikonfirmasi user. status_validasi harus 'tervalidasi'",
  "rule": "R2"
}
```

**Verifikasi di DB:**

```sql
-- Stok TIDAK BERUBAH
SELECT stok FROM products WHERE id = '<PROD_SCM001>';   -- masih 15 (atau apapun terakhir)

-- Tidak ada baris purchases dengan no_nota_supplier='HACK-001'
SELECT COUNT(*) FROM purchases WHERE no_nota_supplier = 'HACK-001';   -- 0

-- Audit R2 REJECTED tercatat (untuk forensik)
SELECT rule_triggered, rule_action, reason_detail
  FROM stock_logs
  WHERE rule_triggered = 'R2'
  ORDER BY created_at DESC
  LIMIT 1;
-- ('R2', 'REJECTED', 'R2: stok masuk belum dikonfirmasi user. ...')
```

---

## Skenario 4 — R2 REJECTED (item tanpa product_id)

**Tujuan:** Buktikan validasi memastikan SETIAP baris harus dipilih `product_id` (tidak boleh draft kosong) — sesuai SYSTEM PROMPT "Tombol Konfirmasi Semua disabled jika ada baris belum dipilih".

```bash
curl -X POST http://localhost:5000/api/purchases/commit \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"no_nota_supplier\": \"INV-DRAFT-EMPTY\",
    \"file_nota_url\": \"path/x.jpg\",
    \"status_validasi\": \"tervalidasi\",
    \"items\": [
      { \"product_id\": \"\", \"qty\": 3, \"harga_beli\": 18000, \"diskon_persen\": 0 }
    ]
  }"
```

**Expected response:** HTTP `400` dengan `rule="R2"` dan reason mengandung `"belum dipilih product_id"`.

**Verifikasi di DB:** sama seperti skenario 3 — stok TIDAK berubah, audit R2 REJECTED tercatat.

---

## Skenario 5 — File terlalu besar / format salah (multer reject)

**Tujuan:** Buktikan multer fileFilter menolak format non-image.

```bash
# Coba upload PDF (Pertemuan 8 belum support PDF)
curl -X POST http://localhost:5000/api/purchases/ocr \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "file=@./nota.pdf"
```

**Expected response:** HTTP `400`

```json
{
  "error": "Format tidak didukung. Pertemuan 8 hanya menerima JPG/PNG/WebP (nota cetak)."
}
```

---

## Skenario 6 — Tanpa Authorization header (lapisan 2 RBAC)

```bash
curl -X POST http://localhost:5000/api/purchases/ocr \
  -F "file=@./nota_cetak.jpg"
```

**Expected response:** HTTP `401` `{ "error": "Token tidak ditemukan" }`

---

## Ringkasan defense-in-depth Pertemuan 8

| Lapisan                  | R2 (Validasi Stok Masuk)                                         | R3 (UPDATE liar)                          | R4 (Konsistensi)                                                        |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Service layer (Express)  | `checkR2PurchaseValidation` di `ruleEngine.js` → 400 + audit log | (UPDATE manual dilarang)                  | Delegasi ke trigger DB                                                  |
| Database (PostgreSQL)    | (n/a — R2 di service layer)                                      | Trigger `fn_products_stok_guard`          | Trigger `fn_purchase_items_apply` (AFTER INSERT) increment + log        |
| Audit trail (stock_logs) | REJECTED ditulis service layer                                   | TRIGGERED ditulis service layer saat exc. | ACCEPTED ditulis trigger DB (`source_type='purchase'`, `delta_qty > 0`) |

| Komponen OCR                  | Implementasi                                                                |
| ----------------------------- | --------------------------------------------------------------------------- |
| Preprocessing (Strategi 2)    | `sharp.greyscale().normalize().median(3).threshold(otsuValue)` dengan Otsu manual via histogram |
| Recognize                     | `tesseract.js` worker `ind+eng` (lazy-init, di-reuse antar request)         |
| Parse                         | Regex per-line untuk qty/harga/diskon/kode + leftover untuk nama_barang     |
| String matching (Levenshtein) | `fast-levenshtein` similarity = 1 - distance/max_len, top-3 candidate       |
| Confidence ambang (Strategi 3)| Threshold 60 untuk jalur cetak; baris < 60 di-flag `low_confidence=true`    |
