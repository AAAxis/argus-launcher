// Minimal RFC 4180 CSV parser: handles quoted fields, embedded commas/newlines,
// and doubled "" quote-escaping, which the profile inventory export relies on
// (user-agent strings, HTML notes, cookie-name lists all contain commas).
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmptyRows = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!nonEmptyRows.length) {
    return [];
  }
  const [header, ...body] = nonEmptyRows;
  return body.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key.trim()] = cells[index] ?? '';
    });
    return record;
  });
}

export function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Builds a CSV body from an ordered header and a row-shaped lookup per item,
// so both exporters (profiles, proxies) agree on quoting and column order.
export function toCsv<T>(header: string[], items: T[], rowFor: (item: T) => Record<string, string>) {
  const lines = [header.join(',')];
  for (const item of items) {
    const row = rowFor(item);
    lines.push(header.map((key) => csvEscape(row[key] ?? '')).join(','));
  }
  return lines.join('\n');
}
