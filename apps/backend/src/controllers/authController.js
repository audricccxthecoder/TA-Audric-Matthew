const { createClient } = require("@supabase/supabase-js");
const supabaseAdmin = require("../config/supabase");

// POST /api/auth/login — verifikasi kredensial via Supabase Auth, kembalikan JWT
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email dan password wajib diisi" });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.warn("[POS-AUTH] Login gagal untuk", email, "-", error.message);
      return res.status(401).json({ error: "Email atau password salah" });
    }

    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", data.user.id)
      .single();

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        username: profile?.username,
        role: profile?.role,
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (err) {
    console.error("[POS-AUTH] Login error:", err.message);
    res.status(500).json({ error: "Gagal login" });
  }
}

// POST /api/auth/logout — invalidate JWT di Supabase Auth (server-side sign out)
async function logout(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token tidak ditemukan" });
  }
  const token = authHeader.split(" ")[1];

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    await supabase.auth.signOut();
    res.json({ message: "Logout berhasil" });
  } catch (err) {
    console.error("[POS-AUTH] Logout error:", err.message);
    res.status(500).json({ error: "Gagal logout" });
  }
}

// POST /api/users — admin only, buat user baru (dipanggil dari users router)
async function register(req, res) {
  const { email, password, username, role } = req.body;

  if (!email || !password || !username || !role) {
    return res.status(400).json({ error: "Semua field wajib diisi" });
  }
  if (!["admin", "kasir"].includes(role)) {
    return res.status(400).json({ error: "Role harus admin atau kasir" });
  }

  try {
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError) {
      return res
        .status(400)
        .json({ error: authError.message || "Gagal membuat user" });
    }

    const { error: profileError } = await supabaseAdmin.from("users").insert({
      id: authData.user.id,
      username,
      role,
    });

    if (profileError) {
      // Rollback auth user kalau profile insert gagal
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      console.error("[POS-AUTH] Register profile error:", profileError.message);
      return res.status(400).json({ error: "Gagal menyimpan profil user" });
    }

    res.status(201).json({
      message: "User berhasil dibuat",
      user: { id: authData.user.id, email, username, role },
    });
  } catch (err) {
    console.error("[POS-AUTH] Register error:", err.message);
    res.status(500).json({ error: "Gagal membuat user" });
  }
}

async function getMe(req, res) {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
      role: req.user.role,
      created_at: req.user.created_at,
    },
  });
}

module.exports = { login, logout, register, getMe };
