// Lapisan 2: RBAC — pastikan req.user.role termasuk dalam allowedRoles
function roleMiddleware(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Belum login" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      console.warn(
        `[POS-RBAC] Tolak akses: user=${req.user.id} role=${req.user.role} butuh=${allowedRoles.join("|")}`
      );
      return res.status(403).json({ error: "Anda tidak memiliki akses untuk fitur ini" });
    }
    next();
  };
}

module.exports = roleMiddleware;
