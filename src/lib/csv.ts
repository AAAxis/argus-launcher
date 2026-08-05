// Minimal RFC 4180 CSV parser: handles quoted fields, embedded commas/newlines,
// and doubled "" quote-escaping, which the profile inventory export relies on
// (user-agent strings, HTML notes, cookie-name lists all contain commas).

// A record plus the 1-based line its first character sat on. The line rides
// along because the importer's only way to name a row it could not read used to
// be the profile name inside it -- which is no help at all for the rows whose
// problem is that the name is missing.
export type ParsedCsvRow = {row: Record<string, string>; line: number};

// Excel writes a UTF-8 BOM. Left in place it becomes part of the first header
// key, so `name` reads back as undefined and every row of an otherwise perfect
// file is rejected for "Missing name". Stripped here rather than at the file
// read so pasted text gets the same treatment.
const BOM = '﻿';

// Header keys are matched case- and separator-insensitively, so "Profile Name",
// "profile-name" and "profile_name" are one column. Values are never touched.
export function normalizeHeaderKey(key: string) {
  return key.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// Comma unless the header line clearly says otherwise. A semicolon file is what
// Excel writes wherever the comma is the decimal separator, and it used to
// parse as a single column named after the entire header row -- every value
// missing, with nothing in the error to suggest the delimiter was the problem.
function detectDelimiter(text: string) {
  const end = text.search(/[\r\n]/);
  const header = end === -1 ? text : text.slice(0, end);
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    const count = header.split(candidate).length - 1;
    // Strictly greater, so a tie leaves the comma in place.
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string): ParsedCsvRow[] {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const delimiter = detectDelimiter(source);
  const rows: Array<{cells: string[]; line: number}> = [];
  let field = '';
  let cells: string[] = [];
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        // A quoted field may span newlines, and they still advance the count --
        // otherwise every row after one is reported against the line its
        // opening quote sat on.
        if (ch === '\n' || (ch === '\r' && source[i + 1] !== '\n')) {
          line++;
        }
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') {
        i++;
      }
      cells.push(field);
      field = '';
      rows.push({cells, line: rowLine});
      cells = [];
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (field.length || cells.length) {
    cells.push(field);
    rows.push({cells, line: rowLine});
  }
  const nonEmptyRows = rows.filter((r) => r.cells.some((cell) => cell.trim() !== ''));
  if (!nonEmptyRows.length) {
    return [];
  }
  const [header, ...body] = nonEmptyRows;
  return body.map(({cells: values, line: at}) => {
    const record: Record<string, string> = {};
    header.cells.forEach((key, index) => {
      const value = values[index] ?? '';
      // Both spellings go into the record: the normalized key is what the
      // importer looks up, and the trimmed raw key keeps anything reading a
      // header verbatim working.
      record[key.trim()] = value;
      record[normalizeHeaderKey(key)] = value;
    });
    return {row: record, line: at};
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
