# 01 — Authentication & RBAC

Modul: login, JWT verification, role-based access control.
Lapisan: 2 (RBAC) & 3 (JWT integrity) — lihat SYSTEM PROMPT bagian Keamanan Berlapis.

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 1.1 | Login dengan kredensial benar (admin) | Email: `admin@local`, Password valid, klik "Login" di halaman `/login` | Berhasil masuk → redirect otomatis ke `/admin/dashboard` (atau `/dashboard` placeholder); profile menampilkan badge "ADMIN"; token tersimpan di localStorage | | |
| 1.2 | Login dengan kredensial benar (kasir) | Email: `kasir@local`, Password valid | Berhasil masuk → redirect ke `/kasir`; badge "KASIR" terlihat | | |
| 1.3 | Login dengan password salah | Email valid, password ngawur | Form tetap di `/login`; toast/error "Email atau password salah"; HTTP 401 di Network tab | | |
| 1.4 | Login dengan email kosong | Email: `(kosong)`, Password: apa saja | Validasi client-side menolak / toast "Email dan password wajib diisi"; tidak hit backend | | |
| 1.5 | Akses halaman admin sebagai kasir (RBAC) | Login sebagai kasir, akses URL `/admin/dashboard` langsung | ProtectedRoute redirect ke `/kasir` (atau halaman role-yang-sesuai); tidak menampilkan konten dashboard | | |
| 1.6 | Akses endpoint backend tanpa JWT | Buka DevTools, panggil `fetch('/api/dashboard/summary')` tanpa header Authorization | Response HTTP 401 dengan body `{"error":"Token tidak ditemukan"}` | | |
