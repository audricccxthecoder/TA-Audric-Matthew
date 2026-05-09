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

// GET /api/users — daftar user, dipakai filter audit-trail dan halaman /admin/users (admin only)
async function listUsers(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, username, role, is_active, created_at")
      .order("username", { ascending: true });
    if (error) throw error;

    // Email disimpan di auth.users (Supabase) — gabungkan via admin API.
    // Maks 50 user, jadi 1x listUsers cukup; kalau nanti grow > 50, paginasi.
    let emailMap = new Map();
    try {
      const { data: authPage } = await supabaseAdmin.auth.admin.listUsers({
        perPage: 200,
      });
      for (const u of authPage?.users || []) {
        emailMap.set(u.id, u.email);
      }
    } catch (e) {
      console.warn("[POS-AUTH] listUsers: gagal ambil email auth:", e.message);
    }

    const enriched = (data || []).map((u) => ({
      ...u,
      email: emailMap.get(u.id) || null,
    }));

    res.json({ data: enriched });
  } catch (err) {
    console.error("[POS-AUTH] listUsers error:", err.message);
    res.status(500).json({ error: "Gagal memuat daftar user" });
  }
}

// PUT /api/users/:id — admin only. Update username / role / email / password.
// Tidak pernah mengubah is_active di sini (pakai endpoint terpisah supaya
// audit-trail jelas: edit profil vs aktivasi).
async function updateUser(req, res) {
  const { id } = req.params;
  const { username, role, email, password } = req.body || {};

  // Validasi minimal
  if (
    username == null &&
    role == null &&
    email == null &&
    password == null
  ) {
    return res.status(400).json({ error: "Tidak ada field yang diubah" });
  }
  if (role != null && !["admin", "kasir"].includes(role)) {
    return res.status(400).json({ error: "Role harus admin atau kasir" });
  }
  if (username != null && (typeof username !== "string" || !username.trim())) {
    return res.status(400).json({ error: "Username tidak valid" });
  }

  // Self-protect: admin tidak boleh menurunkan rolenya sendiri jadi kasir
  // (mencegah lock-out — tidak ada admin tersisa yang bisa promote balik).
  if (id === req.user.id && role && role !== "admin") {
    return res.status(400).json({
      error: "Admin tidak boleh menurunkan role akunnya sendiri",
    });
  }

  try {
    // (1) update profil di tabel users
    const profilePatch = {};
    if (username) profilePatch.username = username.trim();
    if (role) profilePatch.role = role;

    if (Object.keys(profilePatch).length > 0) {
      const { error: pErr } = await supabaseAdmin
        .from("users")
        .update(profilePatch)
        .eq("id", id);
      if (pErr) {
        if (pErr.code === "23505") {
          return res.status(409).json({ error: "Username sudah dipakai" });
        }
        throw pErr;
      }
    }

    // (2) update auth.users (email / password) via admin API
    const authPatch = {};
    if (email) authPatch.email = email;
    if (password) {
      if (typeof password !== "string" || password.length < 6) {
        return res
          .status(400)
          .json({ error: "Password minimal 6 karakter" });
      }
      authPatch.password = password;
    }
    if (Object.keys(authPatch).length > 0) {
      const { error: aErr } =
        await supabaseAdmin.auth.admin.updateUserById(id, authPatch);
      if (aErr) {
        return res.status(400).json({ error: aErr.message });
      }
    }

    console.log(
      `[POS-AUTH] User ${id} diupdate oleh ${req.user.username} (fields: ${Object.keys(
        { ...profilePatch, ...authPatch }
      ).join(",")})`
    );
    res.json({ message: "User berhasil diupdate" });
  } catch (err) {
    console.error("[POS-AUTH] updateUser error:", err.message);
    res.status(500).json({ error: "Gagal mengupdate user" });
  }
}

// PATCH /api/users/:id/status — admin only. Activate/deactivate akun.
// Soft-flag is_active di tabel users; authMiddleware menolak akses tiap request.
async function setUserStatus(req, res) {
  const { id } = req.params;
  const { is_active } = req.body || {};

  if (typeof is_active !== "boolean") {
    return res.status(400).json({ error: "Field 'is_active' (boolean) wajib diisi" });
  }

  // Self-protect: admin tidak boleh menonaktifkan akunnya sendiri
  if (id === req.user.id && is_active === false) {
    return res.status(400).json({
      error: "Admin tidak boleh menonaktifkan akunnya sendiri",
    });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .update({ is_active })
      .eq("id", id)
      .select("id, username, role, is_active")
      .single();
    if (error) {
      if (error.code === "PGRST116")
        return res.status(404).json({ error: "User tidak ditemukan" });
      throw error;
    }
    console.log(
      `[POS-AUTH] User ${data.username} ${is_active ? "diaktifkan" : "dinonaktifkan"} oleh ${req.user.username}`
    );
    res.json({
      message: `User berhasil ${is_active ? "diaktifkan" : "dinonaktifkan"}`,
      data,
    });
  } catch (err) {
    console.error("[POS-AUTH] setUserStatus error:", err.message);
    res.status(500).json({ error: "Gagal mengubah status user" });
  }
}

module.exports = {
  login,
  logout,
  register,
  getMe,
  listUsers,
  updateUser,
  setUserStatus,
};
