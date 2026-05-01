const productRepository = require("../repositories/productRepository");
const salesRepository = require("../repositories/salesRepository");
const stockLogRepository = require("../repositories/stockLogRepository");
const ruleEngine = require("./ruleEngine");

// Bentuk kode_transaksi: INV-YYYYMMDD-XXXXXX (6 char hex acak)
function generateKodeTransaksi() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rnd = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .toUpperCase()
    .padStart(6, "0");
  return `INV-${yyyy}${mm}${dd}-${rnd}`;
}

function validatePayload(items, productsFromDb = []) { // Tambahkan parameter kedua, yaitu products dari Supabase
  if (!Array.isArray(items) || items.length === 0) {
    return "Keranjang kosong: minimal 1 item";
  }

  // Buat Map untuk memudahkan pencarian harga asli
  const productMap = new Map(productsFromDb.map((p) => [p.id, p]));

  for (const it of items) {
    if (!it.product_id || typeof it.product_id !== "string") {
      return "product_id wajib string UUID";
    }
    if (!Number.isInteger(it.qty) || it.qty <= 0) {
      return "qty wajib bilangan bulat > 0";
    }
    if (typeof it.harga_satuan !== "number" || it.harga_satuan <= 0) {
      return "harga_satuan wajib angka > 0";
    }

    // Validasi Harga
    const dbProduct = productMap.get(it.product_id);
    if (dbProduct) {
       const hargaAsli = Number(dbProduct.harga_jual);
       const hargaInput = Number(it.harga_satuan);
       
       if (hargaAsli !== hargaInput) {
         return `Manipulasi Harga! ${dbProduct.nama_barang} aslinya ${hargaAsli}, anda mengirim ${hargaInput}`;
       }
    }
    // ----------------------------------------
  }
  return null;
}

// function validatePayload(items) {
//   if (!Array.isArray(items) || items.length === 0) {
//     return "Keranjang kosong: minimal 1 item";
//   }
//   for (const it of items) {
//     if (!it.product_id || typeof it.product_id !== "string") {
//       return "product_id wajib string UUID";
//     }
//     if (!Number.isInteger(it.qty) || it.qty <= 0) {
//       return "qty wajib bilangan bulat > 0";
//     }
//     if (typeof it.harga_satuan !== "number" || it.harga_satuan <= 0) {
//       return "harga_satuan wajib angka > 0";
//     }
//   }
//   return null;
// }

// Alur POST /api/sales (Gambar 3.5 di laporan)
//   a. validasi payload
//   b. R1 LAYER 1: pre-check stok cukup -> log REJECTED + HTTP 409
//   c-h. RPC fn_create_sale (transaksi atomik di DB; trigger R1/R3/R4 jalan)
//   i.  on error -> map SQLSTATE -> HTTP code; ROLLBACK otomatis di DB


// async function createSale({ user, items }) {
//   // (a) Validasi payload
//   const payloadError = validatePayload(items);
//   if (payloadError) {
//     const e = new Error(payloadError);
//     e.status = 400;
//     throw e;
//   }

async function createSale({ user, items }) {
  // 1. Ambil data produk dulu dari DB (Sekaligus deklarasi ids di sini)
  const ids = [...new Set(items.map((i) => i.product_id))];
  const products = await productRepository.findByIds(ids);

  // 2. Jalankan validasi payload (Termasuk Cek Manipulasi Harga)
  // Pastikan fungsi validatePayload sudah diupdate seperti saran sebelumnya
  const payloadError = validatePayload(items, products); 
  if (payloadError) {
    const e = new Error(payloadError);
    e.status = 400;
    throw e;
  }

  // 3. R1 LAYER 1 — pre-check stok (TIDAK PERLU const ids lagi di sini)
  const failures = ruleEngine.checkR1StockAvailability({ items, products });

  if (failures.length > 0) {
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Tulis stock_logs REJECTED untuk SETIAP item yang gagal R1
    for (const f of failures) {
      const p = productMap.get(f.product_id);
      await stockLogRepository.write({
        product_id: f.product_id,
        user_id: user.id,
        delta_qty: 0,
        stok_sebelum: p?.stok ?? null,
        stok_sesudah: p?.stok ?? null,
        source_type: "sales",
        rule_triggered: "R1",
        rule_action: "REJECTED",
        reason_detail: f.reason,
        context_payload: {
          attempted_items: items,
          failure: f,
        },
      });
    }

    const e = new Error(failures.map((f) => f.reason).join("; "));
    e.status = 409;
    e.rule = "R1";
    e.failures = failures;
    throw e;
  }


  // // (b) R1 LAYER 1 — pre-check stok di service layer
  // const ids = [...new Set(items.map((i) => i.product_id))];
  // const products = await productRepository.findByIds(ids);
  // const failures = ruleEngine.checkR1StockAvailability({ items, products });

  // if (failures.length > 0) {
  //   const productMap = new Map(products.map((p) => [p.id, p]));

  //   // Tulis stock_logs REJECTED untuk SETIAP item yang gagal R1
  //   for (const f of failures) {
  //     const p = productMap.get(f.product_id);
  //     await stockLogRepository.write({
  //       product_id: f.product_id,
  //       user_id: user.id,
  //       delta_qty: 0,
  //       stok_sebelum: p?.stok ?? null,
  //       stok_sesudah: p?.stok ?? null,
  //       source_type: "sales",
  //       rule_triggered: "R1",
  //       rule_action: "REJECTED",
  //       reason_detail: f.reason,
  //       context_payload: {
  //         attempted_items: items,
  //         failure: f,
  //       },
  //     });
  //   }

  //   const e = new Error(failures.map((f) => f.reason).join("; "));
  //   e.status = 409;
  //   e.rule = "R1";
  //   e.failures = failures;
  //   throw e;
  // }

  // (c)-(h) Jalankan transaksi atomik via RPC.
  // Function fn_create_sale internally SET LOCAL app.allow_stok_update='true',
  // INSERT sales, INSERT sale_items (loop). Trigger R4 mengurus UPDATE stok + log ACCEPTED.
  const kodeTransaksi = generateKodeTransaksi();

  // Start Fixing bug security (Price Override Logic)
  const productMap = new Map(products.map((p) => [p.id, p])); 

  const secureItems = items.map((it) => {
    const dbProduct = productMap.get(it.product_id);
    return {
      ...it, // Ambil product_id dan qty dari DB, bukan dari req.body user / inputan user
      harga_satuan:Product.harga_jual // TIMPA harganya secara paksa dari DB!
    };
  });
  // Finishing bug fix security (Price Override)

  let rpcResult;
  try {
    rpcResult = await salesRepository.createSaleViaRpc({
      userId: user.id,
      kodeTransaksi,
      items: secureItems,
    });
  } catch (err) {
    // (i) ROLLBACK terjadi otomatis di DB; map error ke HTTP
    const mapped = ruleEngine.mapDbErrorToHttp(err);

    // Race condition: stok berubah antara pre-check dan INSERT — tetap log REJECTED
    if (mapped.rule === "R1") {
      await stockLogRepository.write({
        product_id: null,
        user_id: user.id,
        source_type: "sales",
        rule_triggered: "R1",
        rule_action: "REJECTED",
        reason_detail: `Race condition R1 di trigger DB: ${mapped.message}`,
        context_payload: { kode_transaksi: kodeTransaksi, items },
      });
    }
    if (mapped.rule === "R3") {
      await stockLogRepository.write({
        product_id: null,
        user_id: user.id,
        source_type: "sales",
        rule_triggered: "R3",
        rule_action: "TRIGGERED",
        reason_detail: mapped.message,
        context_payload: { kode_transaksi: kodeTransaksi, items },
      });
    }

    const e = new Error(mapped.message);
    e.status = mapped.status;
    e.rule = mapped.rule;
    throw e;
  }

  // Ambil receipt lengkap untuk response
  const receipt = await salesRepository.getReceipt(rpcResult.sale_id);
  console.log(
    `[POS-SALES] Transaksi ${receipt.kode_transaksi} sukses oleh user=${user.username} total=${receipt.total_harga}`
  );
  return receipt;
}

async function listSales(filter) {
  return salesRepository.list(filter);
}

module.exports = { createSale, listSales };
