const productRepository = require("../repositories/productRepository");

// GET /api/products?q=&limit=
async function searchProducts(req, res) {
  try {
    const { q = "", limit } = req.query;
    const data = await productRepository.search({
      q,
      limit: limit ? Math.min(parseInt(limit, 10), 50) : 20,
    });
    return res.json({ data });
  } catch (err) {
    console.error("[POS-PROD] searchProducts error:", err.message);
    return res.status(500).json({ error: "Gagal mencari produk" });
  }
}

module.exports = { searchProducts };
