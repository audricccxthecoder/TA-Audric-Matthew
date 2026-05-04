# 08 — Laporan

Modul: `/laporan` (admin-only) — laporan penjualan & pembelian + CSV export.

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 8.1 | Tab penjualan, periode bulan ini | Login admin, buka `/laporan`, default tab "Penjualan", klik Tampilkan | Tabel menampilkan semua sale_items dari awal bulan sampai hari ini; 4 SummaryCard menampilkan total transaksi, qty, baris item, revenue | | |
| 8.2 | Filter periode kustom (penjualan) | Set Dari = 30 hari lalu, Sampai = 7 hari lalu, klik Tampilkan | Tabel hanya menampilkan transaksi pada window itu; summary update | | |
| 8.3 | Tab pembelian, export CSV | Pindah ke tab "Pembelian / Stok Masuk", klik "Export CSV" | File `laporan-purchases_YYYY-MM-DD.csv` terdownload; isi sesuai filter aktif; kolom termasuk No Nota, Sumber (ocr/manual), Status Validasi | | |
| 8.4 | Kasir tidak bisa akses | Login kasir, akses URL `/laporan` | ProtectedRoute redirect ke `/kasir`; tidak menampilkan laporan | | |
