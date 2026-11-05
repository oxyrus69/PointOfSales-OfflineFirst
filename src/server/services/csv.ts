/**
 * CSV helper. Excel Indonesia expects semicolon separators and a UTF-8 BOM;
 * without the BOM, "Rp" and accented characters turn into mojibake.
 */
export const CSV_BOM = "\uFEFF";

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const head = headers.map(csvCell).join(";");
  const body = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  return `${CSV_BOM}${head}\r\n${body}\r\n`;
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function timestampedFilename(prefix: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
}
