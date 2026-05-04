# 03 — Stok Masuk (OCR + Validasi)

Modul: input stok masuk via OCR di `/stok-masuk`.
Rule yang diuji: **R2** (Validasi Stok Masuk), **R4** (Konsistensi Stok).

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 3.1 | Upload nota cetak JPG | Pilih file `nota_test.jpg` (JPG, < 10MB), nama supplier "Toko Suparma", klik "Proses OCR" | Loading; lalu Step 2 menampilkan tabel hasil ekstraksi + preview nota; tiap baris ada dropdown rekomendasi top-3 (Levenshtein) | | |
| 3.2 | Upload nota dengan format tidak didukung | Pilih file PDF | Multer reject; toast/error "Format tidak didukung. Pertemuan 8 hanya menerima JPG/PNG/WebP" | | |
| 3.3 | Upload nota > 10 MB | Pilih file 11 MB | Multer reject; toast "File terlalu besar (maks 10 MB)" | | |
| 3.4 | R2 — Commit tanpa pilih product_id | Hasil OCR ada 3 baris, kosongkan dropdown product_id baris ke-2, klik "Konfirmasi & Simpan" | Tombol Konfirmasi tetap disabled ATAU backend reject HTTP 400 dengan pesan "R2: item baris #2 belum dipilih product_id" | | |
| 3.5 | R2 + R4 — Commit valid | Pilih product_id untuk semua baris, klik "Konfirmasi & Simpan" | Sukses; stok produk bertambah sesuai qty; stock_logs entry R4 ACCEPTED per item; status_validasi = 'tervalidasi' | | |
| 3.6 | Tambah baris manual fallback | Klik "Tambah Baris", pilih produk dari katalog, isi qty + harga, commit | Baris manual disimpan dengan source='manual' (bukan 'ocr'); stok bertambah | | |
