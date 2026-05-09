# 10 — Manajemen User & Notifikasi Low-Stock

Modul: `/admin/users` (admin only) dan badge notifikasi sidebar.
Endpoint: `GET/POST/PUT /api/users`, `PATCH /api/users/:id/status`,
`GET /api/notifications/low-stock`.

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 10.1 | Tambah user kasir baru | Klik "+ Tambah User", isi username/email/role=kasir/password (min 6 char), Simpan | HTTP 201; toast "User dibuat"; baris baru muncul di tabel; kasir baru bisa login | | |
| 10.2 | Tambah user dengan email duplikat | Sama dengan 10.1 tapi email sudah dipakai | Toast error "Gagal membuat user" / "User already registered"; tidak ada baris baru | | |
| 10.3 | Edit role user dari kasir → admin | Buka modal Edit pada user kasir, ubah role ke admin, Simpan | HTTP 200; toast sukses; badge role berubah jadi violet "ADMIN"; user yang bersangkutan dapat akses admin di login berikutnya | | |
| 10.4 | Admin TIDAK boleh turunkan role-nya sendiri | Edit akun admin yang sedang login, ubah role ke kasir | HTTP 400 dengan pesan "Admin tidak boleh menurunkan role akunnya sendiri" | | |
| 10.5 | Reset password user lain | Modal Edit, isi field "Password Baru" dengan password baru | HTTP 200; user yang bersangkutan harus login ulang dengan password baru | | |
| 10.6 | Nonaktifkan user kasir | Klik tombol "Nonaktifkan" pada baris kasir → konfirmasi | HTTP 200; badge status jadi "NONAKTIF"; tombol berubah jadi "Aktifkan"; sesi kasir yang masih login → request berikutnya HTTP 401 "Akun dinonaktifkan" | | |
| 10.7 | Admin TIDAK boleh nonaktifkan diri sendiri | Tombol "Nonaktifkan" pada baris admin yang sedang login | Tombol disabled (dengan tooltip); jika dipaksa via curl → HTTP 400 | | |
| 10.8 | Aktifkan kembali user yang nonaktif | Klik "Aktifkan" pada baris user nonaktif | HTTP 200; badge "AKTIF"; user dapat login lagi tanpa reset password | | |
| 10.9 | Badge notifikasi low-stock muncul untuk admin | Login sebagai admin; sidebar punya item "Rekomendasi Restock" dengan badge merah berisi angka kandidat low-stock | Badge angka = jumlah produk aktif dengan `stok ≤ min_stock`; klik lonceng di header membuka popover dengan 5 barang paling kritis | | |
| 10.10 | Badge notifikasi low-stock muncul untuk kasir | Login sebagai kasir; sidebar punya item "Stok Menipis" dengan badge merah | Badge angka sama dengan admin; klik lonceng → popover sama; klik "Lihat semua" → arahkan ke `/kasir/low-stock` | | |
| 10.11 | Notifikasi auto-refresh 60 detik | Buka halaman; di tab lain commit purchase yang menambah stok produk low-stock di atas min_stock; tunggu 60 detik | Badge berkurang otomatis tanpa refresh halaman | | |
