export type CsvRow = Record<string, string | number | boolean | null | undefined>;

function csvCell(value: CsvRow[string]) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadCsv(fileName: string, rows: CsvRow[]) {
  if (!rows.length) return false;
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const csv = [columns.map(csvCell).join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = fileName; link.click();
  URL.revokeObjectURL(url);
  return true;
}
