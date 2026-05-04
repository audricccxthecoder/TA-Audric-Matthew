# 04 — Master Barang

Modul: CRUD master produk di `/master-barang`.
Rule yang diuji: **R3** (kolom stok dilindungi), RBAC field-level (min_stock admin-only).

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 4.1 | Tambah barang baru (admin) | Login admin, klik "+ Tambah Barang", isi semua field termasuk min_stock=5, submit | Produk baru muncul di tabel; stok awal = 0 (otomatis); status default 'aktif'; toast "Produk berhasil dibuat" | | |
| 4.2 | Tambah barang dengan kode duplikat | Coba tambah produk dengan kode_barang yang sudah dipakai | HTTP 409 / toast "Kode barang sudah dipakai"; produk tidak dibuat | | |
| 4.3 | Edit harga jual (kasir) | Login kasir, edit produk, ubah harga_jual saja, simpan | Sukses; harga_jual update di tabel; stock_logs entry source=manual rule=null action=ACCEPTED dengan reason "Master data produk diubah: harga_jual" | | |
| 4.4 | Edit min_stock sebagai kasir | Login kasir, buka modal edit produk | Field min_stock disabled / readonly; ada label "admin only"; jika dipaksa via DevTools → backend HTTP 403 "Hanya admin yang boleh mengubah min_stock" | | |
| 4.5 | Edit min_stock sebagai admin | Login admin, edit min_stock dari 5 → 10 | Sukses; min_stock di tabel jadi 10; stock_logs entry tertulis | | |
| 4.6 | R3 — Coba edit kolom stok | Modal edit produk, field "Stok Saat Ini" disabled (readonly). Jika via DevTools paksa kirim `{"stok": 99}` ke PATCH | HTTP 400 / 409 dengan pesan menyebut R3; stok DB tidak berubah; stock_logs tidak menulis perubahan stok via jalur ini | | |
| 4.7 | Soft delete (nonaktifkan) | Klik tombol "Nonaktif" pada produk aktif, konfirmasi | Status produk berubah jadi 'nonaktif'; produk tidak muncul lagi di pencarian POS (yang filter status=aktif); tetap muncul di master-barang dengan filter "Semua status" | | |
