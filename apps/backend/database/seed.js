// =================================================================
// seed.js — Seed data demo untuk presentasi skripsi
// =================================================================
// Idempotent: aman dijalankan berulang. Cek-by-key sebelum insert.
//
//   node apps/backend/database/seed.js
//
// Prasyarat:
//   - Semua migrasi sudah di-apply ke Supabase (database/migrations/*.sql,
//     termasuk 008/011 untuk fn_create_sale/fn_commit_purchase dan 012
//     users.is_active).
//   - apps/backend/.env terisi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.
//
// Yang dibuat:
//   - 2 user: admin@asiajaya.local (admin), kasir@asiajaya.local (kasir).
//     Password seragam: "password123" — ganti SETELAH demo.
//   - 50+ produk suku cadang motor realistis (oli, filter, kampas, busi,
//     ban, lampu, aki, dll). Stok awal 0; nanti diisi dari purchases.
//   - 6 purchases tervalidasi (memanggil fn_commit_purchase) → mengisi stok
//     awal via trigger R4 + audit trail.
//   - 25 sales (memanggil fn_create_sale) tersebar 14 hari terakhir →
//     mengurangi stok via trigger R4 + audit trail.
//
// Beberapa produk sengaja dibiarkan dengan stok rendah supaya R5
// (Rekomendasi Restock) dan notifikasi low-stock punya data demo.
// =================================================================

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "[SEED] FATAL: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di apps/backend/.env"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ----------------- DATA: USERS -----------------
const SEED_USERS = [
  {
    email: "admin@asiajaya.local",
    password: "password123",
    username: "owner_asia",
    role: "admin",
  },
  {
    email: "kasir@asiajaya.local",
    password: "password123",
    username: "kasir_lina",
    role: "kasir",
  },
];

// ----------------- DATA: PRODUCTS -----------------
// Format: [kode_barang, nama_barang, merk, harga_beli, harga_jual, min_stock]
const SEED_PRODUCTS = [
  // === OLI MESIN ===
  ["OLI-YAM-080", "Oli Yamalube Sport 0.8L", "Yamalube", 38000, 52000, 10],
  ["OLI-YAM-100", "Oli Yamalube Matic 1L", "Yamalube", 45000, 62000, 10],
  ["OLI-AHM-080", "Oli AHM SPX2 0.8L", "AHM", 40000, 55000, 10],
  ["OLI-AHM-100", "Oli AHM MPX2 1L", "AHM", 47000, 65000, 10],
  ["OLI-SHE-100", "Oli Shell Advance AX5 1L", "Shell", 50000, 72000, 8],
  ["OLI-CAS-100", "Oli Castrol Power1 1L", "Castrol", 55000, 78000, 8],
  ["OLI-MOT-100", "Oli Motul 5100 1L", "Motul", 78000, 105000, 5],
  ["OLI-FED-080", "Oli Federal Supreme XX 0.8L", "Federal", 35000, 48000, 10],
  // === OLI GARDAN / TRANSMISI ===
  ["OLG-YAM-012", "Oli Gardan Yamalube 120ml", "Yamalube", 12000, 18000, 15],
  ["OLG-AHM-012", "Oli Gardan AHM 120ml", "AHM", 13000, 20000, 15],
  // === FILTER UDARA ===
  ["FIL-BEAT-01", "Filter Udara Beat/Vario 110", "Honda Genuine", 28000, 45000, 8],
  ["FIL-MIO-01", "Filter Udara Mio/Soul GT", "Yamaha Genuine", 30000, 48000, 8],
  ["FIL-VAR125", "Filter Udara Vario 125/150", "Honda Genuine", 35000, 55000, 6],
  ["FIL-NMAX01", "Filter Udara NMAX 155", "Yamaha Genuine", 42000, 65000, 6],
  ["FIL-PCX160", "Filter Udara PCX 160", "Honda Genuine", 48000, 72000, 5],
  // === BUSI ===
  ["BSI-NGK-CR7", "Busi NGK CR7HSA", "NGK", 18000, 28000, 20],
  ["BSI-NGK-CR8", "Busi NGK CR8E", "NGK", 22000, 32000, 20],
  ["BSI-DEN-U22", "Busi Denso U22FSU", "Denso", 25000, 38000, 15],
  ["BSI-NGK-IRD", "Busi NGK Iridium CR8EIX", "NGK Iridium", 95000, 135000, 5],
  // === KAMPAS REM ===
  ["KMP-DPN-BEAT", "Kampas Rem Depan Beat/Vario", "Indopart", 22000, 35000, 12],
  ["KMP-DPN-MIO", "Kampas Rem Depan Mio", "Indopart", 22000, 35000, 12],
  ["KMP-DPN-NMX", "Kampas Rem Depan NMAX/Aerox", "Brembo Repl", 55000, 85000, 8],
  ["KMP-BLK-BEAT", "Kampas Rem Belakang (Tromol) Beat", "Indopart", 28000, 42000, 12],
  ["KMP-BLK-MIO", "Kampas Rem Belakang Mio", "Indopart", 28000, 42000, 12],
  ["KMP-KOPL-MIO", "Kampas Kopling Mio Set", "Aspira", 75000, 115000, 6],
  ["KMP-KOPL-VAR", "Kampas Kopling Vario 125 Set", "Aspira", 78000, 120000, 6],
  // === V-BELT / CVT ===
  ["VBT-MIO-J", "V-Belt Mio J/M3", "Mitsuboshi", 65000, 95000, 8],
  ["VBT-BEAT", "V-Belt Beat Karbu/FI", "Mitsuboshi", 68000, 98000, 8],
  ["VBT-VAR125", "V-Belt Vario 125/150", "Mitsuboshi", 78000, 115000, 6],
  ["VBT-NMAX", "V-Belt NMAX 155", "Mitsuboshi", 95000, 140000, 5],
  ["RLR-MIO-12", "Roller Mio 12gr (set 6 pcs)", "Kawahara", 45000, 70000, 10],
  ["RLR-BEAT-13", "Roller Beat 13gr (set 6 pcs)", "Kawahara", 45000, 70000, 10],
  // === BAN LUAR ===
  ["BAN-IRC-708", "Ban IRC NR82 70/90-14", "IRC", 175000, 245000, 5],
  ["BAN-IRC-808", "Ban IRC NR82 80/90-14", "IRC", 195000, 275000, 5],
  ["BAN-FDR-708", "Ban FDR Sport XR 70/90-14", "FDR", 165000, 235000, 5],
  ["BAN-MIC-110", "Ban Michelin City Pro 110/70-13", "Michelin", 285000, 395000, 3],
  ["BAN-COR-150", "Ban Corsa Platinum 150/60-13", "Corsa", 425000, 575000, 3],
  // === BAN DALAM ===
  ["BAD-IRC-14", "Ban Dalam IRC 14 inch", "IRC", 28000, 42000, 15],
  ["BAD-IRC-13", "Ban Dalam IRC 13 inch", "IRC", 28000, 42000, 15],
  // === LAMPU ===
  ["LMP-LED-BEAT", "Lampu LED Headlamp Beat", "GDP", 55000, 85000, 10],
  ["LMP-LED-MIO", "Lampu LED Headlamp Mio", "GDP", 55000, 85000, 10],
  ["LMP-HAL-12V", "Bohlam Halogen 12V 35/35W", "Phillips", 18000, 28000, 20],
  ["LMP-REM-12V", "Bohlam Lampu Rem 12V 5/21W", "Phillips", 8000, 14000, 25],
  ["LMP-SEN-AMB", "Bohlam Sein Amber 12V 10W", "Phillips", 6000, 11000, 25],
  // === AKI ===
  ["AKI-GS-MF3", "Aki GS GTZ5S 3Ah Maintenance Free", "GS Astra", 165000, 235000, 4],
  ["AKI-GS-MF5", "Aki GS GTZ7S 5Ah MF", "GS Astra", 195000, 275000, 4],
  ["AKI-YUASA", "Aki Yuasa YTZ5S 3Ah MF", "Yuasa", 175000, 245000, 4],
  // === GEAR / RANTAI (BEBEK) ===
  ["GR-RAN-RAJA", "Gear Set + Rantai Supra X 125", "Indopart", 165000, 235000, 5],
  ["GR-RAN-JUPZ", "Gear Set + Rantai Jupiter Z", "Indopart", 155000, 225000, 5],
  ["RTC-SUP-100", "Rantai SCM 428H-104 mata", "SCM", 55000, 85000, 8],
  // === KARBURATOR / CVT BAGIAN ===
  ["KRB-PE28", "Karburator Keihin PE 28mm", "Keihin", 425000, 575000, 2],
  // === TUNE-UP / KONSUMABEL ===
  ["TUN-SET-MTC", "Paket Tune-Up Matic (oli+filter+busi)", "Mix", 95000, 145000, 8],
  ["TUN-SET-BBK", "Paket Tune-Up Bebek (oli+filter+busi)", "Mix", 88000, 135000, 8],
];

// Sentinel untuk seed transaksi/pembelian — biar idempotent
const SEED_TX_PREFIX = "INV-SEED";
const SEED_NOTA_PREFIX = "NOTA-SEED";

// ----------------- HELPERS -----------------
async function ensureUser({ email, password, username, role }) {
  // Coba login dulu via API admin: list user dengan filter email
  const { data: list } =
    await supabase.auth.admin.listUsers({ perPage: 200 });
  const existing = (list?.users || []).find((u) => u.email === email);

  if (existing) {
    // Pastikan profil di tabel users juga ada
    const { data: prof } = await supabase
      .from("users")
      .select("id")
      .eq("id", existing.id)
      .maybeSingle();
    if (!prof) {
      await supabase.from("users").insert({ id: existing.id, username, role });
    }
    return existing.id;
  }

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const { error: pErr } = await supabase
    .from("users")
    .insert({ id: created.user.id, username, role });
  if (pErr) throw pErr;
  console.log(`[SEED]  user dibuat: ${email} (${role})`);
  return created.user.id;
}

async function upsertProduct([
  kode_barang,
  nama_barang,
  merk,
  harga_beli,
  harga_jual,
  min_stock,
]) {
  const { data: existing } = await supabase
    .from("products")
    .select("id, stok")
    .eq("kode_barang", kode_barang)
    .maybeSingle();

  if (existing) {
    // Hanya update field master (jangan sentuh stok — itu domain R3/R4)
    await supabase
      .from("products")
      .update({ nama_barang, merk, harga_beli, harga_jual, min_stock })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from("products")
    .insert({
      kode_barang,
      nama_barang,
      merk,
      harga_beli,
      harga_jual,
      stok: 0,
      min_stock,
      status: "aktif",
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

async function purchaseAlreadySeeded(noNota) {
  const { count } = await supabase
    .from("purchases")
    .select("id", { count: "exact", head: true })
    .eq("no_nota_supplier", noNota);
  return (count || 0) > 0;
}

async function saleAlreadySeeded(kodeTransaksi) {
  const { count } = await supabase
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("kode_transaksi", kodeTransaksi);
  return (count || 0) > 0;
}

function pad(n) {
  return String(n).padStart(3, "0");
}

// ----------------- MAIN -----------------
(async function main() {
  try {
    console.log("[SEED] Mulai seeding...");
    console.log(`[SEED] Target: ${SUPABASE_URL}`);

    // (1) USERS
    const userIds = {};
    for (const u of SEED_USERS) {
      userIds[u.role] = await ensureUser(u);
    }
    console.log(`[SEED] ${SEED_USERS.length} user OK`);

    // (2) PRODUCTS
    const productIdByKode = {};
    for (const row of SEED_PRODUCTS) {
      const id = await upsertProduct(row);
      productIdByKode[row[0]] = { id, harga_beli: row[3], harga_jual: row[4] };
    }
    console.log(`[SEED] ${SEED_PRODUCTS.length} produk OK`);

    // (3) PURCHASES — restock awal supaya stok ≥ 0 untuk demo
    const PURCHASES = [
      {
        no: `${SEED_NOTA_PREFIX}-001`,
        items: [
          ["OLI-YAM-080", 30, 38000],
          ["OLI-AHM-080", 30, 40000],
          ["OLI-YAM-100", 25, 45000],
          ["FIL-BEAT-01", 20, 28000],
          ["BSI-NGK-CR7", 50, 18000],
        ],
      },
      {
        no: `${SEED_NOTA_PREFIX}-002`,
        items: [
          ["VBT-MIO-J", 15, 65000],
          ["VBT-BEAT", 15, 68000],
          ["KMP-DPN-BEAT", 20, 22000],
          ["KMP-DPN-MIO", 20, 22000],
          ["RLR-MIO-12", 18, 45000],
        ],
      },
      {
        no: `${SEED_NOTA_PREFIX}-003`,
        items: [
          ["BAN-IRC-708", 12, 175000],
          ["BAN-IRC-808", 12, 195000],
          ["BAD-IRC-14", 30, 28000],
          ["BAD-IRC-13", 30, 28000],
        ],
      },
      {
        no: `${SEED_NOTA_PREFIX}-004`,
        items: [
          ["LMP-LED-BEAT", 18, 55000],
          ["LMP-LED-MIO", 18, 55000],
          ["LMP-HAL-12V", 40, 18000],
          ["LMP-REM-12V", 50, 8000],
          ["LMP-SEN-AMB", 50, 6000],
        ],
      },
      {
        no: `${SEED_NOTA_PREFIX}-005`,
        items: [
          ["AKI-GS-MF3", 8, 165000],
          ["AKI-GS-MF5", 8, 195000],
          ["AKI-YUASA", 6, 175000],
        ],
      },
      {
        no: `${SEED_NOTA_PREFIX}-006`,
        items: [
          ["TUN-SET-MTC", 12, 95000],
          ["TUN-SET-BBK", 12, 88000],
          ["GR-RAN-RAJA", 6, 165000],
          ["GR-RAN-JUPZ", 6, 155000],
        ],
      },
    ];

    let purchasesCreated = 0;
    for (const p of PURCHASES) {
      if (await purchaseAlreadySeeded(p.no)) continue;
      const items = p.items.map(([kode, qty, hb]) => ({
        action: "restock",
        product_id: productIdByKode[kode].id,
        qty,
        harga_beli: hb,
        diskon_persen: 0,
        source: "manual",
      }));
      const { error } = await supabase.rpc("fn_commit_purchase", {
        p_user_id: userIds.kasir,
        p_no_nota_supplier: p.no,
        p_file_nota_url: null,
        p_items: items,
      });
      if (error) {
        console.warn(`[SEED] Gagal seed ${p.no}: ${error.message}`);
        continue;
      }
      purchasesCreated++;
    }
    console.log(`[SEED] ${purchasesCreated} purchase baru di-commit (sisanya sudah ada)`);

    // (4) SALES — 25 transaksi tersebar 14 hari ke belakang
    // Pakai backdate via UPDATE created_at sesudahnya supaya dashboard
    // analytics punya tren yang menarik untuk demo.
    const SALE_TEMPLATES = [
      ["OLI-YAM-080", 1],
      ["OLI-AHM-080", 1],
      ["OLI-YAM-100", 1],
      ["FIL-BEAT-01", 1],
      ["BSI-NGK-CR7", 2],
      ["VBT-MIO-J", 1],
      ["VBT-BEAT", 1],
      ["KMP-DPN-BEAT", 1],
      ["KMP-DPN-MIO", 1],
      ["BAN-IRC-708", 1],
      ["BAD-IRC-14", 2],
      ["LMP-LED-BEAT", 1],
      ["LMP-HAL-12V", 2],
      ["LMP-REM-12V", 3],
      ["TUN-SET-MTC", 1],
      ["AKI-GS-MF3", 1],
    ];

    let salesCreated = 0;
    for (let i = 1; i <= 25; i++) {
      const kode = `${SEED_TX_PREFIX}-${pad(i)}`;
      if (await saleAlreadySeeded(kode)) continue;

      // Pilih 1-3 item acak dari template
      const nItems = 1 + (i % 3);
      const picked = [];
      for (let k = 0; k < nItems; k++) {
        const t = SALE_TEMPLATES[(i + k) % SALE_TEMPLATES.length];
        picked.push(t);
      }
      const items = picked.map(([kodeBarang, qty]) => ({
        product_id: productIdByKode[kodeBarang].id,
        qty,
        harga_satuan: productIdByKode[kodeBarang].harga_jual,
      }));

      const { error } = await supabase.rpc("fn_create_sale", {
        p_user_id: userIds.kasir,
        p_kode_transaksi: kode,
        p_items: items,
      });
      if (error) {
        // Kalau stok kurang (R1), skip — wajar untuk seed
        if (/stok|R1/i.test(error.message)) {
          console.warn(`[SEED] ${kode} skip (stok kurang): ${error.message}`);
        } else {
          console.warn(`[SEED] ${kode} gagal: ${error.message}`);
        }
        continue;
      }

      // Backdate ke (i-1) hari yang lalu, jam acak siang
      const daysAgo = Math.floor((i - 1) / 2); // 2 transaksi per hari
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      d.setHours(9 + (i % 8), (i * 7) % 60, 0, 0);
      await supabase
        .from("sales")
        .update({ created_at: d.toISOString() })
        .eq("kode_transaksi", kode);

      salesCreated++;
    }
    console.log(`[SEED] ${salesCreated} sale baru (backdated 14 hari)`);

    console.log("[SEED] Selesai.");
    console.log("[SEED] Login demo:");
    console.log("[SEED]   admin@asiajaya.local / password123");
    console.log("[SEED]   kasir@asiajaya.local / password123");
  } catch (err) {
    console.error("[SEED] FATAL:", err);
    process.exit(1);
  }
})();
