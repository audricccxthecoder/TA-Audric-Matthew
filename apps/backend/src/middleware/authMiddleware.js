const { createClient } = require("@supabase/supabase-js");
const supabaseAdmin = require("../config/supabase");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Lapisan 2 & 3: verifikasi JWT Supabase (signature, exp, sub claim) lalu attach profil user
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token tidak ditemukan" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      console.warn("[POS-AUTH] JWT verify gagal:", error?.message);
      return res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return res.status(401).json({ error: "Profil user tidak ditemukan" });
    }

    // Soft-deactivate (Pertemuan 13): admin bisa nonaktifkan akun lewat
    // PATCH /api/users/:id/status. Sesi yang masih punya JWT valid pun
    // langsung kehilangan akses karena dicek tiap request.
    if (profile.is_active === false) {
      return res.status(401).json({ error: "Akun Anda telah dinonaktifkan" });
    }

    req.user = { ...user, ...profile };
    next();
  } catch (err) {
    console.error("[POS-AUTH] Authentikasi error:", err.message);
    return res.status(401).json({ error: "Autentikasi gagal" });
  }
}

module.exports = authMiddleware;
