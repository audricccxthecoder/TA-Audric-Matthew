const supabase = require("../config/supabase");

const ALLOWED_RULES = ["R1", "R2", "R3", "R4", "R5"];
const ALLOWED_ACTIONS = ["TRIGGERED", "REJECTED", "ACCEPTED"];
const ALLOWED_SOURCES = ["sales", "purchase", "manual"];

function applyFilters(query, filters) {
  const { from, to, user_id, product_id, rule, action, source_type } = filters;
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);
  if (user_id) query = query.eq("user_id", user_id);
  if (product_id) query = query.eq("product_id", product_id);
  if (rule && ALLOWED_RULES.includes(rule)) query = query.eq("rule_triggered", rule);
  if (action && ALLOWED_ACTIONS.includes(action)) query = query.eq("rule_action", action);
  if (source_type && ALLOWED_SOURCES.includes(source_type))
    query = query.eq("source_type", source_type);
  return query;
}

// Listing dengan pagination (server-side)
async function list(filters) {
  const page = Math.max(parseInt(filters.page, 10) || 1, 1);
  const pageSize = Math.min(
    Math.max(parseInt(filters.page_size, 10) || 50, 1),
    200
  );
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from("stock_logs")
    .select(
      "id, product_id, user_id, delta_qty, stok_sebelum, stok_sesudah, source_type, rule_triggered, rule_action, reason_detail, context_payload, created_at, products(kode_barang, nama_barang), users(username, role)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  query = applyFilters(query, filters);

  const { data, error, count } = await query;
  if (error) throw new Error("Gagal memuat audit log");

  return {
    rows: (data || []).map(normalizeRow),
    page,
    page_size: pageSize,
    total: count || 0,
    total_pages: Math.max(1, Math.ceil((count || 0) / pageSize)),
  };
}

// Listing UNPAGED untuk export CSV (cap di 10k baris untuk safety)
async function listAll(filters, cap = 10000) {
  let query = supabase
    .from("stock_logs")
    .select(
      "id, product_id, user_id, delta_qty, stok_sebelum, stok_sesudah, source_type, rule_triggered, rule_action, reason_detail, context_payload, created_at, products(kode_barang, nama_barang), users(username, role)"
    )
    .order("created_at", { ascending: false })
    .limit(cap);
  query = applyFilters(query, filters);

  const { data, error } = await query;
  if (error) throw new Error("Gagal memuat audit log");
  return (data || []).map(normalizeRow);
}

function normalizeRow(r) {
  return {
    id: r.id,
    created_at: r.created_at,
    user_id: r.user_id,
    username: r.users?.username || null,
    user_role: r.users?.role || null,
    product_id: r.product_id,
    kode_barang: r.products?.kode_barang || null,
    nama_barang: r.products?.nama_barang || null,
    source_type: r.source_type,
    rule_triggered: r.rule_triggered,
    rule_action: r.rule_action,
    delta_qty: r.delta_qty,
    stok_sebelum: r.stok_sebelum,
    stok_sesudah: r.stok_sesudah,
    reason_detail: r.reason_detail,
    context_payload: r.context_payload,
  };
}

module.exports = { list, listAll, ALLOWED_RULES, ALLOWED_ACTIONS, ALLOWED_SOURCES };
