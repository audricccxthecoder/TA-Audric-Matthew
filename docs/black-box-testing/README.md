# Black Box Testing — POS CV Asia Jaya Maju

Pengujian fungsional black box untuk seluruh modul yang sudah diimplementasikan
sampai Pertemuan 10. Setiap berkas berisi tabel skenario per modul dengan kolom
`Aktual` dan `Status` yang diisi saat eksekusi testing manual.

## Cara Mengisi

1. Pastikan sistem sudah jalan: backend (`npm run dev` di `apps/backend/`) dan
   frontend (`npm run dev` di `apps/frontend/`).
2. Login sebagai user yang dibutuhkan oleh skenario (admin / kasir).
3. Eksekusi tiap skenario sesuai kolom **Input**, lalu bandingkan output yang
   tampil dengan **Ekspektasi**.
4. Tulis hasil yang benar-benar terjadi di kolom **Aktual**.
5. Isi **Status** dengan `PASS` jika sesuai ekspektasi, `FAIL` jika tidak.
6. Jika `FAIL`, catat bug-nya, perbaiki, lalu re-test sampai `PASS`.

## Daftar Modul

| Berkas | Modul | Skenario |
| --- | --- | --- |
| [01-auth.md](./01-auth.md) | Authentication & RBAC (Lapisan 2/3) | 6 |
| [02-sales.md](./02-sales.md) | POS Penjualan + R1 + R3 + R4 | 7 |
| [03-purchases-ocr.md](./03-purchases-ocr.md) | OCR Stok Masuk + R2 + R4 | 6 |
| [04-master-barang.md](./04-master-barang.md) | CRUD Master Barang | 7 |
| [05-audit-trail.md](./05-audit-trail.md) | Audit Trail + Filter + CSV | 5 |
| [06-restock-r5.md](./06-restock-r5.md) | R5 Rekomendasi Restock | 3 |
| [07-dashboard.md](./07-dashboard.md) | Dashboard Analytics (eaglance + modal) | 10 |
| [08-laporan.md](./08-laporan.md) | Laporan Penjualan & Pembelian | 4 |
| [09-konsistensi-stok.md](./09-konsistensi-stok.md) | Konsistensi Stok End-to-End (R1+R3+R4) | 8 |
| [10-user-management.md](./10-user-management.md) | Manajemen User & Notifikasi Low-Stock | 11 |

**Total: 67 skenario** (target minimal 30 ✓)

## Lingkungan Pengujian

- Browser: Chrome/Edge versi terbaru (mode standar)
- OS: Windows 11
- Resolusi: 1920×1080 (desktop)
- Backend port: 5000
- Frontend port: 3000
- Database: Supabase PostgreSQL

## Konvensi Status

- **PASS** — output sistem persis sesuai ekspektasi
- **FAIL** — output sistem berbeda dari ekspektasi (catat di "Aktual")
- **N/A** — skenario tidak relevan / dilewati (jelaskan alasan)
