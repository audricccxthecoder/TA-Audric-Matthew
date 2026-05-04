# 05 — Audit Trail

Modul: tabel audit di `/audit-trail`.
Yang diuji: filter, pagination, CSV export, RBAC admin-only.

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 5.1 | Akses sebagai kasir | Login kasir, navigasi ke `/audit-trail` | ProtectedRoute redirect ke `/kasir`; tidak menampilkan konten audit | | |
| 5.2 | Filter rule R1 | Login admin, di halaman audit pilih dropdown Rule = "R1 — Stok Negatif", klik Terapkan | Tabel hanya menampilkan baris dengan rule_triggered = R1; total counter berubah | | |
| 5.3 | Filter kombinasi (rule + tanggal + action) | Filter rule = R4, action = ACCEPTED, dari = 7 hari lalu, sampai = sekarang | Tabel hanya menampilkan baris yang memenuhi SEMUA kondisi (AND filter) | | |
| 5.4 | Pagination | Lakukan filter yang menghasilkan > 50 baris, klik "Next ›" | Halaman bergeser ke 2; counter "Halaman 2 dari N"; baris berbeda dari halaman 1 | | |
| 5.5 | Export CSV | Klik tombol "Export CSV" | File CSV terdownload dengan nama `audit-trail_YYYY-MM-DD.csv`; berisi header Indonesia (Waktu, User, Role, Kode Barang, …); data sesuai filter aktif; bisa dibuka di Excel tanpa garbled karakter (BOM UTF-8) | | |
