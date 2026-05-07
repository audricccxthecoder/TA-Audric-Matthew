require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const productRoutes = require("./routes/products");
const salesRoutes = require("./routes/sales");
const purchaseRoutes = require("./routes/purchases");
const dashboardRoutes = require("./routes/dashboard");
const auditRoutes = require("./routes/audit");
const reportsRoutes = require("./routes/reports");
const restockRoutes = require("./routes/restock");

const app = express();
const PORT = process.env.PORT || 5000;

// Lapisan 4: HTTP security headers (HSTS, CSP, X-Frame-Options, dll)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

// FRONTEND_URL boleh comma-separated — supaya satu backend bisa melayani
// laptop (localhost:3000) dan HP via LAN (mis. 172.22.127.9:3000) bersamaan
// untuk testing live-scan kamera HP.
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // origin undefined = same-origin / curl / mobile webview tertentu → izinkan
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/restock", restockRoutes);

app.use((err, req, res, next) => {
  console.error("[POS-SRV]", err.stack);
  res.status(500).json({ error: "Terjadi kesalahan pada server" });
});

app.listen(PORT, () => {
  console.log(`[POS-SRV] Server running on port ${PORT}`);
});
