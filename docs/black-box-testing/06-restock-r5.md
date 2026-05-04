# 06 — R5 Rekomendasi Restock

Modul: view PostgreSQL `v_restock_recommendation` + heatmap di `/admin/dashboard`.

| No | Skenario | Input | Ekspektasi | Aktual | Status |
|---|---|---|---|---|---|
| 6.1 | Heatmap menampilkan produk stok ≤ min_stock | Pastikan ada produk dengan stok ≤ min_stock (mis. set min_stock = 20 untuk produk yang stok = 5) | Pada `/admin/dashboard`, panel "Heatmap Stok Menipis" menampilkan produk tersebut dengan warna oranye/merah; tooltip menampilkan "Stok: 5 / Min: 20" | | |
| 6.2 | Heatmap menyembunyikan produk normal | Untuk produk dengan stok > min_stock × 1.5 | Produk TIDAK muncul di heatmap (level normal di-filter); muncul di `/master-barang` saja | | |
| 6.3 | Stok jadi 0 setelah penjualan | Kurangi stok suatu produk hingga 0 via penjualan | Heatmap menampilkan kotak warna MERAH (level=out) untuk produk tersebut; metric card "Stok Menipis" bertambah | | |
