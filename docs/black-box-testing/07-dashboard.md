# 07 — Dashboard Analytics

Modul: `/admin/dashboard` (admin-only) — eaglance no-scroll + drill-down via modal popup.

## Pengujian Layout (Eaglance No-Scroll)

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 7.1 | Layout muat 1 viewport tanpa scroll | Login admin, buka `/admin/dashboard` di laptop 1366×768 dan 1920×1080 | Seluruh isi (4 metric cards + 2 chart) terlihat tanpa perlu scroll. Tidak ada scrollbar vertikal di area dashboard | | |
| 7.2 | Metric cards menampilkan angka real-time | Pastikan ada beberapa transaksi hari ini & R1 rejected | 4 kartu menampilkan: Transaksi Hari Ini, Stok Masuk 7 Hari, R1 Ditolak Hari Ini, Stok Menipis. Subteks "Stok negatif: 0 ✓" terlihat di kartu Stok Menipis | | |
| 7.3 | Line chart tren penjualan | Tunggu data ter-load | LineChart Recharts muncul memenuhi panel kiri, sumbu X tanggal DD/MM, sumbu Y revenue, ada 30 titik | | |
| 7.4 | Bar chart top 10 produk | Tunggu data ter-load | BarChart horizontal di panel kanan, max 10 bar, label produk di sumbu Y, tooltip muncul saat hover | | |

## Pengujian Modal Drill-Down

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 7.5 | Modal Transaksi Hari Ini | Klik kartu "Transaksi Hari Ini" | Modal popup muncul; berisi tabel daftar transaksi hari ini (waktu, kode, total). Tutup via tombol X / klik backdrop / tombol Esc | | |
| 7.6 | Modal R1 Ditolak | Klik kartu "R1 Ditolak Hari Ini" | Modal popup berisi tabel audit log dengan rule=R1 action=REJECTED hari ini, kolom Waktu/User/Produk/Alasan terisi | | |
| 7.7 | Modal Heatmap Stok Menipis | Klik kartu "Stok Menipis" | Modal popup berisi grid heatmap kotak warna per produk (merah=habis, oranye=di bawah min, kuning=mendekati min) + legend | | |
| 7.8 | Modal Detail Produk via Bar Chart | Klik salah satu bar di Top 10 | Modal popup menampilkan detail produk yang di-klik: nama, kode, merk, qty terjual 30d, revenue, dan tabel riwayat penjualan terakhir | | |
| 7.9 | Modal Detail Hari via Line Chart | Klik salah satu titik di line chart | Modal popup berisi daftar transaksi tanggal itu. Klik baris untuk expand → muncul detail item per transaksi | | |
| 7.10 | R1 metric bertambah saat ada penolakan | Catat angka "R1 Ditolak". Lakukan transaksi yang ditolak R1 (skenario 2.3). Refresh dashboard | Angka kartu "R1 Ditolak Hari Ini" bertambah; klik kartu → modal langsung tampilkan baris baru | | |
