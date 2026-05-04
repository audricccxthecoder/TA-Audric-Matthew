// Utility serialisasi array of object ke CSV (RFC 4180-friendly).
// Quote tiap field, escape `"` jadi `""`. Sesuai untuk Excel ID lokale (UTF-8 BOM optional).

function escapeField(value) {
  if (value === null || value === undefined) return "";
  let s;
  if (typeof value === "object") {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  // Escape double quotes by doubling them
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}

// rows: array of object. columns: [{ key, header }] urutan kolom CSV.
function toCsv(rows, columns) {
  const header = columns.map((c) => escapeField(c.header)).join(",");
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const v =
            typeof c.format === "function" ? c.format(row[c.key], row) : row[c.key];
          return escapeField(v);
        })
        .join(",")
    )
    .join("\r\n");
  // BOM agar Excel ID auto-detect UTF-8
  return "﻿" + header + "\r\n" + body + "\r\n";
}

function sendCsv(res, filename, rows, columns) {
  const csv = toCsv(rows, columns);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/"/g, "")}"`
  );
  res.send(csv);
}

module.exports = { toCsv, sendCsv };
