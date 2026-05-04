# 02 — POS Penjualan (Modul Sales)

Modul: transaksi penjualan di `/kasir`.
Rule yang diuji: **R1** (Pencegahan Stok Negatif), **R3** (Stok Terpusat), **R4** (Konsistensi Stok).

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 2.1 | Transaksi tunggal sukses | Pilih 1 produk dengan stok cukup, qty = 1, klik "Bayar" | Toast "Transaksi … berhasil"; modal struk muncul dengan kode INV-…; stok produk berkurang 1; stock_logs entry baru dengan rule=R4, action=ACCEPTED | | |
| 2.2 | Transaksi multi-item sukses | Tambah 3 produk berbeda ke keranjang, qty bervariasi, klik "Bayar" | Semua item masuk transaksi; total = penjumlahan subtotal; tiap item menghasilkan baris stock_logs R4 ACCEPTED | | |
| 2.3 | R1 — Stok kurang dari qty diminta | Produk X stok = 2, set qty di keranjang = 5, klik "Bayar" | Transaksi DITOLAK; HTTP 409; toast error menyebut nama barang & "request 5, tersedia 2"; stok TIDAK BERKURANG; stock_logs entry R1 REJECTED tertulis | | |
| 2.4 | R1 — Stok 0 | Produk Y stok = 0, coba tambah ke keranjang | Tombol "+ Tambah" disabled atau toast "Stok habis"; tidak bisa masuk keranjang | | |
| 2.5 | R1 — Multi-item dengan satu stok kurang | Item A stok cukup, Item B stok kurang. Submit transaksi 2 item | Seluruh transaksi ROLLBACK (atomik). Item A juga TIDAK terjual. stok A & B sama persis sebelum submit. Error mention item B | | |
| 2.6 | R3 — Coba update stok langsung via API | Panggil `PATCH /api/products/:id` dengan body `{"stok": 999}` | HTTP 400 dengan pesan "Field 'stok' tidak boleh diubah lewat endpoint ini (R3)"; stok di DB tidak berubah | | |
| 2.7 | F8 keyboard shortcut | Buka `/kasir`, isi keranjang, tekan F8 | Transaksi tersubmit otomatis (sama seperti klik Bayar) | | |
