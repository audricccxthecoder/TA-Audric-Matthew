# 09 — Konsistensi Stok End-to-End

Skenario integrasi yang membuktikan **stok di tabel `products` selalu konsisten**
dengan akumulasi penjualan & pembelian — sesuai janji R3 (Stok Terpusat) dan R4
(Konsistensi Stok). Semua skenario dijalankan dengan kombinasi `curl` (backend
langsung) dan UI (frontend), supaya jelas bahwa rule ditegakkan di kedua jalur.

Prasyarat:
- Server backend jalan di `http://localhost:5000`.
- Sudah login sebagai kasir, JWT disimpan di variabel `$T` (Bash) atau
  `$env:T` (PowerShell). Contoh:
  ```bash
  T=$(curl -s -X POST http://localhost:5000/api/auth/login \
        -H 'Content-Type: application/json' \
        -d '{"email":"kasir@asiajaya.local","password":"password123"}' \
        | jq -r .session.access_token)
  ```
- Pilih satu produk uji dengan kode `OLI-YAM-080` (dari seed). Catat `id` dan
  `stok_awal` lewat:
  ```bash
  curl -s -H "Authorization: Bearer $T" \
        "http://localhost:5000/api/products?q=OLI-YAM-080" | jq
  ```

| No | Skenario | Langkah | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 9.1 | Penjualan biasa kurangi stok persis sesuai qty | (a) Catat `stok_awal`. (b) POST `/api/sales` qty=3. (c) Cek stok lagi. | `stok_baru = stok_awal - 3`. Ada baris baru di `stock_logs` dengan `delta_qty = -3`, `rule_triggered=R4`, `rule_action=ACCEPTED`. | | |
| 9.2 | R1 reject TIDAK mengubah stok | (a) Catat `stok_awal`. (b) POST `/api/sales` dengan qty melebihi stok. (c) Cek stok. | HTTP 409 dengan `rule:"R1"`. Stok **identik** dengan sebelum POST (tidak berkurang sama sekali). `stock_logs` punya baris R1 REJECTED. | | |
| 9.3 | R1 atomik (transaksi multi-item) | POST `/api/sales` dengan 2 item: item A stok cukup, item B stok kurang. | Seluruh transaksi DITOLAK. Stok item A juga TIDAK berkurang (rollback DB). Audit `stock_logs` mencatat R1 REJECTED. | | |
| 9.4 | R3 tolak UPDATE stok manual via API | `curl -X PATCH /api/products/<id>` body `{"stok": 999}`. | HTTP 400 dengan pesan menyebut R3. Stok di DB **tidak berubah**. | | |
| 9.5 | R3 tolak UPDATE stok manual langsung di DB | Di Supabase SQL editor: `UPDATE products SET stok=stok+10 WHERE id='<id>';` (sebagai service_role). | Query gagal dengan SQLSTATE `45R03` dan pesan menyebut R3. Stok tetap. (Trigger BEFORE UPDATE menolak.) | | |
| 9.6 | R4 stok masuk menambah stok persis sesuai qty | (a) Catat `stok_awal`. (b) POST `/api/purchases/commit` 1 item qty=20. (c) Cek stok. | `stok_baru = stok_awal + 20`. `stock_logs` punya baris baru dengan `delta_qty=+20`, `rule_triggered=R4`, `source_type=purchase`. | | |
| 9.7 | Audit lengkap untuk satu hari | Setelah skenario 9.1–9.6 dijalankan: GET `/api/audit-logs?from=<today>` (admin). | Semua delta tercatat. `SUM(delta_qty)` per produk dari log = `stok_akhir - stok_awal_hari_itu`. (Reconciliation manual dari log.) | | |
| 9.8 | Tidak ada stok negatif | `SELECT id, kode_barang, stok FROM products WHERE stok < 0;` di Supabase. | Result set **kosong** (0 rows). Setelah seluruh testing selesai, invariant ini harus selalu berlaku — bukti bahwa R1+R3+R4 menjaga integritas. | | |

## Catatan Reconciliation

Skenario 9.7 adalah inti dari pembuktian konsistensi: untuk satu produk dalam
periode tertentu,

```
stok_akhir == stok_awal
            + SUM(delta_qty WHERE source_type='purchase' AND rule_action='ACCEPTED')
            + SUM(delta_qty WHERE source_type='sales'    AND rule_action='ACCEPTED')
```

Skenario 9.2 dan 9.3 membuktikan bahwa **REJECTED** entri di `stock_logs`
tidak ikut mengubah `products.stok` — hanya `ACCEPTED` yang berkontribusi.
Sifat atomik diberikan oleh function `fn_create_sale` / `fn_commit_purchase`
(plpgsql) yang berjalan dalam satu transaksi DB.
