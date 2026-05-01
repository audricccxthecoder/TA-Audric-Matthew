require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const productRoutes = require("./routes/products");
const salesRoutes = require("./routes/sales");
const purchaseRoutes = require("./routes/purchases");

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

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
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

app.use((err, req, res, next) => {
  console.error("[POS-SRV]", err.stack);
  res.status(500).json({ error: "Terjadi kesalahan pada server" });
});

app.listen(PORT, () => {
  console.log(`[POS-SRV] Server running on port ${PORT}`);
});
