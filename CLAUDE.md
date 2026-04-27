# Prompt Claude Code untuk Tugas Akhir — POS + OCR + Rule-Based System
## CV Asia Jaya Maju | Audric Matthew Wirawan (C14220332)

> **Cara Pakai:** Copy-paste prompt sesuai fase ke Claude Code di VS Code. Jalankan satu fase per sesi bimbingan. Setiap fase membangun di atas fase sebelumnya.

---

## 🔧 PROMPT AWAL (System/Project Prompt — Pasang di CLAUDE.md)

Buat file `CLAUDE.md` di root project kamu, lalu isi dengan ini. Claude Code akan membacanya otomatis setiap sesi.

```markdown
# Project: POS System — CV Asia Jaya Maju

## Overview
Sistem Point of Sale (POS) berbasis web untuk toko suku cadang sepeda motor CV Asia Jaya Maju.
Mengintegrasikan OCR (Tesseract) untuk input stok masuk dari nota supplier dan Rule-Based System untuk menjaga konsistensi data persediaan.

## Tech Stack
- **Frontend:** Next.js (App Router), JavaScript, Tailwind CSS, shadcn/ui
- **Backend:** Node.js + Express.js, REST API
- **Database:** PostgreSQL via Supabase (auth, realtime, storage)
- **OCR:** Tesseract.js (client-side) atau Tesseract via backend
- **Charts:** Recharts atau Chart.js
- **Deployment:** Vercel (frontend) + Railway/Render (backend) atau Supabase Edge Functions

## Architecture
- Client-server architecture with REST API
- RBAC: 2 roles — Admin/Owner dan Kasir
- Supabase handles auth, database, realtime subscriptions, and file storage
- Backend Express.js handles business logic, rule-based system, and OCR processing

## Database Tables (PostgreSQL/Supabase)
- users (id, username, email, role, created_at)
- products (id, kode_barang, nama_barang, merk, harga_beli, harga_jual, stok, min_stok, status, created_at, updated_at)
- transactions (id, kode_transaksi, user_id, total, created_at)
- transaction_items (id, transaction_id, product_id, qty, harga_jual, subtotal)
- stock_ins (id, supplier_name, nota_file_url, tanggal, user_id, status, created_at)
- stock_in_items (id, stock_in_id, product_id, qty, harga_beli, diskon_persen, validated, created_at)
- audit_trail (id, user_id, action, table_name, record_id, old_value, new_value, rule_triggered, created_at)

## Rule-Based System Rules
1. **Prevent Negative Stock:** Block sale if product stock < requested qty
2. **Validate Stock In:** Stock updates only through validated stock-in process
3. **Centralized Stock Update:** Stock changes only via sales transactions or validated stock-in
4. **Data Consistency:** Every stock-affecting transaction syncs inventory immediately

## Coding Conventions
- Use Indonesian for UI labels and user-facing text
- Use English for code (variable names, functions, comments)
- Always implement proper error handling
- Use parameterized queries (Supabase SDK handles this)
- Follow RESTful API conventions
- Component files: PascalCase. Utility files: camelCase.
```

---

## FASE 1 — Project Setup, Database & Authentication
**Target Bimbingan 1:** Menunjukkan arsitektur sistem, database schema yang sudah jalan, dan sistem login dengan RBAC.

### Prompt 1.1 — Inisialisasi Project

```
Bantu saya setup project dari nol untuk sistem POS berbasis web.

Buat 2 folder terpisah:
1. /frontend — Next.js app (App Router, JavaScript, Tailwind CSS, shadcn/ui)
2. /backend — Express.js app (Node.js)

Untuk frontend:
- Setup Next.js dengan App Router
- Install dan konfigurasi Tailwind CSS + shadcn/ui
- Buat layout dasar dengan sidebar navigation
- Setup environment variables untuk Supabase URL dan anon key

Untuk backend:
- Setup Express.js dengan struktur folder: routes/, controllers/, middleware/, services/, config/
- Install: express, cors, dotenv, @supabase/supabase-js, multer (untuk file upload nanti)
- Setup CORS untuk allow frontend origin
- Buat health check endpoint GET /api/health
- Setup environment variables untuk Supabase URL dan service role key

Buat juga file .env.example untuk kedua folder.
```

### Prompt 1.2 — Database Schema & Supabase Setup

```
Sekarang bantu saya buat database schema di Supabase (PostgreSQL).

Buat SQL migration file yang berisi semua CREATE TABLE statements sesuai schema di CLAUDE.md. Tambahkan juga:

1. Table `users` — dengan kolom role ENUM ('admin', 'kasir')
2. Table `products` — dengan kolom min_stok (default 5), status ENUM ('active', 'inactive')
3. Table `transactions` dan `transaction_items` — untuk penjualan
4. Table `stock_ins` dan `stock_in_items` — untuk stok masuk dari supplier, dengan kolom `validated` boolean default false
5. Table `audit_trail` — untuk mencatat semua perubahan stok

Tambahkan juga:
- Foreign key constraints yang benar
- Index pada kolom yang sering di-query (kode_barang, kode_transaksi, created_at)
- Database trigger untuk: setiap INSERT ke transaction_items, otomatis kurangi stok di products
- Database trigger untuk: setiap INSERT ke stock_in_items yang validated=true, otomatis tambah stok di products
- Database trigger untuk: PREVENT update langsung ke kolom `stok` di products (harus lewat transaksi atau stok masuk)
- RLS (Row Level Security) policies di Supabase

Buat file: /backend/database/migrations/001_initial_schema.sql
```

### Prompt 1.3 — Authentication & RBAC

```
Implementasikan sistem autentikasi dan Role-Based Access Control (RBAC).

Backend (Express.js):
1. Buat auth middleware yang verifikasi Supabase JWT token dari header Authorization
2. Buat role middleware: requireRole('admin') dan requireRole('kasir')
3. Buat endpoint POST /api/auth/login (via Supabase auth)
4. Buat endpoint POST /api/auth/register (admin only — untuk buat user kasir baru)
5. Buat endpoint GET /api/auth/me — return current user profile + role

Frontend (Next.js):
1. Buat AuthContext/Provider yang handle login state, token storage, dan auto-refresh
2. Buat halaman /login dengan form username/email + password
3. Buat protected route wrapper yang redirect ke /login jika belum auth
4. Buat role-based route guard: admin routes dan kasir routes
5. Setelah login, redirect ke dashboard sesuai role:
   - Admin → /admin/dashboard
   - Kasir → /kasir/pos

Pastikan token disimpan dengan aman dan ada mekanisme logout.
```

---

## FASE 2 — Master Data & Transaksi Penjualan (POS)
**Target Bimbingan 2:** Menunjukkan CRUD master barang dan fitur POS kasir yang sudah bisa melakukan transaksi penjualan dengan Rule-Based System pencegahan stok negatif.

### Prompt 2.1 — CRUD Master Barang

```
Implementasikan fitur CRUD Master Barang.

Backend:
1. GET /api/products — list semua barang (support search, filter status, pagination)
2. GET /api/products/:id — detail satu barang
3. POST /api/products — tambah barang baru (kasir & admin)
4. PUT /api/products/:id — update data barang (kecuali kolom stok — stok tidak boleh diubah langsung!)
5. DELETE /api/products/:id — soft delete (ubah status ke inactive)

Setiap operasi yang mengubah data harus dicatat di audit_trail.

Frontend:
1. Halaman /kasir/products — tabel master barang dengan search bar dan filter
2. Modal/form untuk tambah barang baru dengan field: kode_barang, nama_barang, merk, harga_beli, harga_jual, stok_awal, min_stok
3. Modal/form untuk edit barang (field stok di-disable, tidak bisa diedit manual)
4. Tombol hapus dengan konfirmasi
5. Tampilkan badge "Stok Menipis" jika stok <= min_stok, dan "Stok Habis" jika stok = 0

Gunakan tabel yang rapi dengan shadcn/ui Table component.
```

### Prompt 2.2 — POS Kasir (Transaksi Penjualan)

```
Implementasikan fitur Point of Sale untuk kasir melakukan transaksi penjualan.

Backend:
1. POST /api/transactions — buat transaksi baru
   - Terima array of items: [{product_id, qty}]
   - RULE 1 (Prevent Negative Stock): Sebelum proses, cek setiap item apakah stok cukup. Jika ada satu saja yang stok tidak cukup, TOLAK seluruh transaksi dan return error yang jelas (sebutkan barang mana yang stok kurang)
   - Jika semua stok cukup, buat record di transactions dan transaction_items
   - Stok di-update melalui database trigger (bukan manual UPDATE)
   - Catat di audit_trail: user, barang, qty, rule yang terpicu (jika ada)
2. GET /api/transactions — list transaksi (filter by date range, pagination)
3. GET /api/transactions/:id — detail transaksi + items

Frontend — Halaman /kasir/pos:
1. Layout 2 kolom:
   - Kiri: Search barang + list hasil pencarian (klik untuk tambah ke keranjang)
   - Kanan: Keranjang belanja (list item, qty bisa diubah, hapus item, total harga)
2. Pencarian barang by nama atau kode_barang (debounced search)
3. Keranjang belanja:
   - Tampilkan nama, harga jual, qty, subtotal per item
   - Tampilkan total keseluruhan
   - Tombol + dan - untuk ubah qty
   - Validasi: jika qty > stok tersedia, tampilkan warning
4. Tombol "Proses Transaksi" — kirim ke backend
5. Jika sukses: tampilkan receipt/struk sederhana, reset keranjang
6. Jika gagal (stok kurang): tampilkan error message dari backend

Pastikan UX-nya smooth dan cepat untuk operasional toko yang sibuk.
```

---

## FASE 3 — OCR Input Stok Masuk
**Target Bimbingan 3:** Demo fitur upload nota supplier, proses OCR, tampilkan hasil ekstraksi, dan form validasi user sebelum data masuk ke database.

### Prompt 3.1 — OCR Backend Processing

```
Implementasikan modul OCR untuk memproses nota pembelian supplier.

Backend:
1. POST /api/stock-in/upload — upload file nota (JPG/PNG/PDF)
   - Simpan file ke Supabase Storage bucket 'nota-supplier'
   - Return file URL dan stock_in_id

2. POST /api/stock-in/:id/process-ocr — proses OCR pada nota yang sudah diupload
   - Download file dari Supabase Storage
   - Preprocessing citra sebelum OCR:
     a. Konversi ke grayscale
     b. Thresholding (adaptive threshold)
     c. Noise removal
     d. Deskewing (perbaiki kemiringan)
   - Gunakan Tesseract (tesseract.js atau node-tesseract-ocr) untuk ekstraksi teks
   - Parse hasil OCR untuk mengekstrak:
     a. Nama barang
     b. Kode barang
     c. Jumlah barang
     d. Harga beli
     e. Persentase diskon
   - Untuk setiap item hasil OCR, jalankan string matching (Levenshtein Distance) terhadap nama barang di database untuk memberikan rekomendasi product_id
   - Simpan hasil sebagai DRAFT di stock_in_items (validated = false)
   - Return hasil OCR + rekomendasi barang

Untuk preprocessing, gunakan library sharp atau jimp untuk image processing.
Untuk Levenshtein Distance, buat utility function sendiri atau gunakan library fastest-levenshtein.

Pastikan error handling yang baik jika OCR gagal — sistem tetap harus bisa fallback ke input manual.
```

### Prompt 3.2 — OCR Frontend & Validasi User

```
Implementasikan halaman input stok masuk dengan OCR dan validasi user.

Frontend — Halaman /kasir/stock-in:

1. Step 1 — Upload Nota:
   - Form input: nama supplier, tanggal pembelian
   - Upload area (drag & drop atau klik) untuk file JPG/PNG/PDF
   - Preview gambar nota yang diupload
   - Tombol "Proses OCR"
   - Loading indicator saat OCR sedang berjalan

2. Step 2 — Validasi Hasil OCR:
   - Tampilkan tabel hasil ekstraksi OCR dengan kolom:
     a. Nama barang (hasil OCR) — editable
     b. Kode barang (hasil OCR) — editable
     c. Rekomendasi barang dari database (dropdown select, hasil string matching)
     d. Jumlah — editable
     e. Harga beli — editable
     f. Diskon (%) — editable
     g. Status: "Terbaca Benar" / "Perlu Koreksi" / "Input Manual"
   - Di samping tabel, tampilkan preview nota agar user bisa cross-check
   - Tombol "Tambah Baris" untuk item yang tidak terbaca OCR (input manual penuh)
   - Setiap baris bisa dihapus jika tidak relevan
   - Dropdown rekomendasi barang menampilkan top 5 hasil string matching dengan similarity score

3. Step 3 — Konfirmasi & Simpan:
   - RULE 2 (Validate Stock In): Semua item WAJIB di-validasi oleh user
   - Tombol "Validasi & Simpan" — hanya aktif jika semua baris sudah dipilih product_id dari database
   - RULE 3 (Centralized Stock Update): Setelah validasi, update stok melalui mekanisme resmi (trigger database)
   - Tampilkan summary: total item, total nilai pembelian
   - Setelah berhasil, catat di audit_trail

4. Halaman /kasir/stock-in/history — riwayat stok masuk dengan detail per nota
```

---

## FASE 4 — Admin Dashboard & Analytics
**Target Bimbingan 4:** Menunjukkan dashboard admin dengan grafik tren penjualan, grafik stok, heatmap stok menipis, dan laporan-laporan.

### Prompt 4.1 — Dashboard & Visualisasi Data

```
Implementasikan dashboard analitik untuk Admin/Owner.

Backend — Endpoint analytics:
1. GET /api/analytics/sales-trend — data penjualan per hari/minggu/bulan (parameter: period, start_date, end_date)
2. GET /api/analytics/stock-movement — data stok masuk vs keluar per periode
3. GET /api/analytics/low-stock — daftar barang yang stok <= min_stok, diurutkan dari paling kritis
4. GET /api/analytics/top-products — top 10 barang terlaris berdasarkan qty terjual
5. GET /api/analytics/summary — ringkasan: total produk, total transaksi hari ini, total revenue hari ini, jumlah barang stok menipis

Frontend — Halaman /admin/dashboard:
1. Summary cards di atas: Total Produk, Transaksi Hari Ini, Revenue Hari Ini, Stok Menipis (count)
2. Grafik Tren Penjualan (line chart) — bisa toggle harian/mingguan/bulanan, gunakan Recharts
3. Grafik Stok Masuk vs Keluar (bar chart) — perbandingan per bulan
4. Heatmap Stok Menipis — tampilkan grid/tabel barang-barang yang stok di bawah minimum, dengan warna intensity berdasarkan seberapa kritis (merah = habis, kuning = menipis)
5. Top 10 Barang Terlaris (horizontal bar chart)
6. Semua chart harus ada date range picker untuk filter periode

Gunakan Recharts untuk semua chart. Pastikan responsive dan loading state yang baik.
```

### Prompt 4.2 — Laporan & Audit Trail

```
Implementasikan fitur laporan dan audit trail untuk Admin.

Backend:
1. GET /api/reports/sales — laporan penjualan (filter: date range, export-ready data)
2. GET /api/reports/inventory — laporan persediaan saat ini (semua produk + stok + status)
3. GET /api/reports/stock-history/:product_id — riwayat perubahan stok suatu barang
4. GET /api/audit-trail — list audit trail (filter: user, action, date range, table_name, pagination)

Frontend:
1. Halaman /admin/reports/sales:
   - Filter tanggal (dari-sampai)
   - Tabel: tanggal, kode transaksi, kasir, total item, total harga
   - Summary: total transaksi, total revenue dalam periode
   - Tombol export (opsional)

2. Halaman /admin/reports/inventory:
   - Tabel semua produk: kode, nama, merk, stok saat ini, min_stok, harga beli, harga jual, status
   - Filter: status stok (semua/menipis/habis/normal)
   - Search by nama/kode

3. Halaman /admin/reports/stock-history:
   - Pilih produk, tampilkan timeline perubahan stok
   - Setiap entry: tanggal, jenis (penjualan/stok masuk), qty berubah, stok sebelum → sesudah, user

4. Halaman /admin/audit-trail:
   - Tabel: timestamp, user, action (create/update/delete), tabel, detail perubahan, rule yang terpicu
   - Filter by user, action type, date range
   - Detail row bisa di-expand untuk lihat old_value dan new_value

Audit trail sangat penting untuk skripsi ini — ini menunjukkan Rule-Based System bekerja dan menjaga konsistensi data.
```

---

## FASE 5 — Admin User Management & Refinement
**Target Bimbingan 5:** Menunjukkan fitur admin untuk kelola user, notifikasi stok menipis, dan perbaikan-perbaikan dari feedback dosen di sesi sebelumnya.

### Prompt 5.1 — User Management & Notifikasi

```
Implementasikan fitur manajemen user dan sistem notifikasi.

Backend:
1. GET /api/users — list semua user (admin only)
2. POST /api/users — buat user baru dengan role (admin only)
3. PUT /api/users/:id — update data user, termasuk ganti role (admin only)
4. DELETE /api/users/:id — nonaktifkan user (admin only)
5. GET /api/notifications/low-stock — daftar barang stok di bawah minimum

Frontend:
1. Halaman /admin/users:
   - Tabel user: username, email, role, status, tanggal dibuat
   - Tombol tambah user baru (form: username, email, password, role)
   - Tombol edit dan nonaktifkan user
   - Admin tidak bisa menghapus dirinya sendiri

2. Komponen Notifikasi (di sidebar/header):
   - Badge/counter menunjukkan jumlah barang stok menipis
   - Klik untuk lihat daftar barang yang perlu restock
   - Tampilkan: nama barang, stok saat ini, min_stok
   - Notifikasi ini muncul untuk role Admin dan Kasir

3. Halaman /kasir/low-stock:
   - Daftar barang stok habis dan stok menipis
   - Diurutkan: stok habis dulu, lalu berdasarkan selisih terdekat ke min_stok
```

### Prompt 5.2 — Polish & UX Improvements

```
Lakukan perbaikan dan polish pada keseluruhan aplikasi.

1. Responsive design — pastikan semua halaman bisa digunakan di layar laptop dan tablet
2. Loading states — tambahkan skeleton loader atau spinner di setiap halaman yang fetch data
3. Error handling — tampilkan toast/notification yang jelas saat terjadi error
4. Empty states — tampilkan pesan yang informatif jika tabel kosong
5. Konfirmasi dialog — untuk semua aksi destructive (hapus, proses transaksi)
6. Breadcrumb navigation — di semua halaman
7. Sidebar navigation yang jelas — icon + label, highlight halaman aktif, collapse di mobile
8. Form validation — client-side validation untuk semua form sebelum submit
9. Print receipt — halaman struk transaksi yang bisa di-print (/kasir/transactions/:id/receipt)
10. Keyboard shortcut — di halaman POS, bisa search barang dengan shortcut

Pastikan semua halaman konsisten secara visual dan menggunakan design system yang sama (shadcn/ui + Tailwind).
```

---

## FASE 6 — Testing, Dokumentasi & Final
**Target Bimbingan 6:** Menunjukkan hasil testing (black box, konsistensi stok, UAT), dokumentasi, dan sistem yang siap deploy.

### Prompt 6.1 — Testing

```
Bantu saya membuat skenario testing dan implementasinya.

1. Black Box Testing — buat dokumen/tabel test cases:
   - Login: login berhasil, login gagal, akses halaman tanpa auth
   - RBAC: kasir akses halaman admin (harus ditolak), admin akses semua
   - Master Barang: CRUD lengkap, validasi input
   - POS Transaksi: transaksi normal, transaksi dengan stok tidak cukup (harus ditolak), transaksi multi-item
   - Stok Masuk OCR: upload nota, proses OCR, validasi, simpan
   - Stok Masuk Manual: input tanpa OCR (fallback)
   - Laporan: filter by date, data akurat

2. Testing Konsistensi Data Stok — buat script test:
   - Catat stok awal barang X
   - Lakukan transaksi penjualan (qty = 5)
   - Cek stok berkurang 5
   - Lakukan stok masuk (qty = 10)
   - Cek stok bertambah 10
   - Coba transaksi yang melebihi stok → harus DITOLAK
   - Cek stok TIDAK BERUBAH setelah transaksi ditolak
   - Coba ubah stok langsung via API tanpa transaksi → harus DITOLAK

3. Testing Rule-Based System:
   - Test pencegahan stok negatif
   - Test validasi wajib sebelum stok masuk
   - Test pembaruan stok terpusat (stok hanya berubah dari transaksi/stok masuk)
   - Cek audit trail mencatat semua aktivitas dengan benar

4. Testing OCR:
   - Siapkan tabel hasil testing OCR:
     | No | Jenis Nota | Jumlah Item | Terbaca Benar | Perlu Koreksi | Input Manual | Waktu OCR | Waktu Manual |

Buat semua test case dalam format tabel yang rapi untuk lampiran skripsi.
```

### Prompt 6.2 — Seed Data & Final Deployment

```
Bantu saya menyiapkan seed data dan finalisasi untuk demo/presentasi.

1. Buat script seed data (backend/database/seed.sql atau seed.js):
   - 2 user: 1 admin (owner), 1 kasir
   - 50+ produk suku cadang motor dengan data realistis (nama, kode, merk, harga, stok bervariasi — ada yang normal, menipis, dan habis)
   - 20+ transaksi penjualan historis (spread across beberapa hari)
   - 5+ record stok masuk yang sudah tervalidasi
   - Audit trail entries yang sesuai

2. Environment setup documentation:
   - README.md yang lengkap: cara install, setup env, jalankan frontend & backend
   - Instruksi setup Supabase project
   - Instruksi menjalankan migration dan seed data

3. Final checks:
   - Semua endpoint terproteksi auth
   - Semua sensitive data (password, token) tidak exposed
   - CORS configured properly
   - Error messages user-friendly (bahasa Indonesia)
   - Semua fitur di CLAUDE.md sudah terimplementasi

Pastikan aplikasi bisa di-demo secara smooth di depan dosen.
```

---

## 💡 Tips Penggunaan

1. **Sebelum setiap sesi bimbingan**, jalankan aplikasi dan test semua fitur yang sudah dibuat
2. **Screenshot** setiap fitur yang sudah jalan untuk ditunjukkan ke dosen
3. **Catat** feedback dosen setelah setiap bimbingan, lalu minta Claude Code perbaiki:
   ```
   Dosen saya memberikan feedback berikut dari sesi bimbingan terakhir:
   1. [feedback 1]
   2. [feedback 2]
   Tolong bantu saya implementasikan perbaikan ini.
   ```
4. **Jangan langsung paste semua prompt** — kerjakan satu prompt, pastikan jalan, baru lanjut
5. **Jika ada error**, paste error message ke Claude Code dan minta dia fix
6. **Untuk revisi daftar revisi sidang proposal** (halaman 2-3 PDF), beberapa sudah ter-cover:
   - ✅ String matching (Levenshtein) — Fase 3
   - ✅ Image preprocessing OCR — Fase 3
   - ✅ Dashboard analytics & heatmap — Fase 4
   - ✅ Database triggers PostgreSQL — Fase 1
   - ✅ Audit trail detail — Fase 4
   - ✅ Implementasi langsung di toko — mulai dari Fase 2 sudah bisa ditest
