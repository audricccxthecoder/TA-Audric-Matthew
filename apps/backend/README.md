# Backend — POS CV Asia Jaya Maju

Express 5 (Node.js) REST API. Menangani auth/RBAC, transaksi penjualan,
OCR stok masuk, audit trail, dashboard analitik, dan rule-based system.

> Lihat [README utama](../../README.md) untuk overview lengkap dan
> setup Supabase. Berkas ini fokus pada hal-hal khusus backend.

## Setup

```bash
npm install
cp .env.example .env       # lalu isi SUPABASE_URL, kunci, FRONTEND_URL
npm run dev                # node --watch src/server.js
```

Server jalan di `http://localhost:5000`. Health check: `GET /api/health`.

### OCR tulisan tangan (opsional)

`@u4/opencv4nodejs` dipakai untuk preprocessing nota tulisan tangan
(deskew, bilateral filter, adaptive threshold). Native autobuild
butuh:

- Visual Studio Build Tools (workload "Desktop development with C++")
- CMake ≥ 3.20
- Python 3 (untuk node-gyp)

Kalau autobuild gagal, set `OPENCV4NODEJS_DISABLE_AUTOBUILD=1` dan
install OpenCV terpisah. Server tetap boot tanpa OpenCV — jalur OCR
**cetak** tetap jalan; jalur **tulisan tangan** otomatis fallback ke
input manual.

## Struktur

```
src/
├── server.js              app + middleware + route mounting
├── config/
│   └── supabase.js        client service-role (bypass RLS)
├── middleware/
│   ├── authMiddleware.js  verifikasi JWT Supabase + cek is_active
│   └── roleMiddleware.js  cek req.user.role
├── routes/                Express routers per resource
├── controllers/           HTTP handler tipis
├── services/              business logic + rule engine
├── repositories/          akses Supabase (SQL boundary)
└── utils/csv.js           helper export CSV (UTF-8 BOM, RFC4180)
database/
├── migrations/            *.sql per app (010_purchase_drafts)
└── seed.js                idempotent seed via Supabase JS SDK
tests/
├── sales_scenarios.md     curl scenarios untuk POS
└── purchases_scenarios.md curl scenarios untuk OCR/commit
```

## Endpoint Map

| Method | Path                              | Role         | Fungsi |
| ------ | --------------------------------- | ------------ | --- |
| POST   | `/api/auth/login`                 | -            | Login (Supabase) |
| POST   | `/api/auth/logout`                | auth         | Logout |
| GET    | `/api/auth/me`                    | auth         | Profil current user |
| GET    | `/api/users`                      | admin        | Daftar user |
| POST   | `/api/users`                      | admin        | Buat user |
| PUT    | `/api/users/:id`                  | admin        | Edit user |
| PATCH  | `/api/users/:id/status`           | admin        | Aktifkan/nonaktifkan |
| GET    | `/api/products`                   | auth         | Search produk |
| GET    | `/api/products/:id`               | auth         | Detail produk |
| POST   | `/api/products`                   | kasir/admin  | Buat produk |
| PATCH  | `/api/products/:id`               | kasir/admin  | Edit (R3 menolak `stok`) |
| GET    | `/api/sales`                      | kasir/admin  | Daftar transaksi |
| POST   | `/api/sales`                      | kasir/admin  | Transaksi (R1, R3, R4) |
| GET    | `/api/sales/:id`                  | kasir/admin  | Detail transaksi (struk) |
| POST   | `/api/purchases/ocr`              | kasir/admin  | Upload nota + OCR |
| POST   | `/api/purchases/commit`           | kasir/admin  | Commit purchase (R2, R4) |
| GET    | `/api/purchases`                  | auth         | Daftar pembelian |
| GET    | `/api/dashboard/*`                | admin        | Summary, sales-trend, top-products, low-stock heatmap |
| GET    | `/api/audit-logs`                 | admin        | Audit trail + filter + CSV |
| GET    | `/api/reports/*`                  | admin        | Laporan penjualan / pembelian (CSV) |
| GET    | `/api/restock`                    | admin        | R5 rekomendasi restock |
| GET    | `/api/notifications/low-stock`    | kasir/admin  | Top-5 barang menipis (badge) |

## Rule-Based System — implementasi singkat

| Rule | File utama                                    | Mekanisme |
| ---- | --------------------------------------------- | --------- |
| R1   | `services/salesService.js` + trigger DB       | Pre-check stok; ROLLBACK kalau RAISE EXCEPTION |
| R2   | `services/purchasesService.js`                | Semua item harus punya `product_id` user-validated |
| R3   | trigger `BEFORE UPDATE products` (006)        | Tolak UPDATE kolom `stok` kecuali `app.allow_stok_update='true'` |
| R4   | trigger `AFTER INSERT sale_items / purchase_items` (006) | Update `products.stok` + tulis `stock_logs` |
| R5   | view `v_restock_recommendation` (007 + 010)   | Read-only — `stok ≤ min_stock`, urgensi + avg 30d |

Atomicity penjualan & pembelian dilindungi oleh `fn_create_sale` dan
`fn_commit_purchase` (plpgsql). Lihat `database/migrations/008,009,011`.

## Seed Data

```bash
npm run seed
```

Lihat `database/seed.js` — idempotent, pakai upsert by `kode_barang`
dan cek-by-key untuk transaksi (`INV-SEED-001`..) dan purchase
(`NOTA-SEED-001`..). Pakai RPC `fn_create_sale` / `fn_commit_purchase`
supaya stok terupdate via trigger R4 (jadi audit trail juga terisi).
