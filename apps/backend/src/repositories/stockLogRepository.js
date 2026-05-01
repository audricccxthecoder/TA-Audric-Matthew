const supabase = require("../config/supabase");

// Tulis satu baris stock_logs. Dipakai service layer untuk mencatat REJECTED
// (R1 di-Layer-1) — untuk ACCEPTED (R4) audit ditulis oleh trigger di DB.
async function write({
  product_id = null,
  user_id,
  delta_qty = 0,
  stok_sebelum = null,
  stok_sesudah = null,
  source_type,
  rule_triggered,
  rule_action,
  reason_detail,
  context_payload = null,
}) {
  const { error } = await supabase.from("stock_logs").insert({
    product_id,
    user_id,
    delta_qty,
    stok_sebelum,
    stok_sesudah,
    source_type,
    rule_triggered,
    rule_action,
    reason_detail,
    context_payload,
  });

  if (error) {
    // Audit gagal tulis — JANGAN melempar exception yang menyembunyikan error utama
    console.error("[POS-STOCKLOG] write error:", error.message);
  }
}

module.exports = { write };
