/** Audit text includes free text typed by users. A cell that starts with = + - @ can run as a formula in a spreadsheet. */
export function csvCell(v: string | number): string {
  let x = String(v);
  if (/^[=+\-@\t\r]/.test(x)) x = `'${x}`;
  return `"${x.replace(/"/g, '""')}"`;
}
