import {describe, expect, it} from 'vitest';
import {parseCsv, toCsv} from './csv';

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('name,proxy\nAlice,socks5://1.2.3.4:1080')).toEqual([
      {row: {name: 'Alice', proxy: 'socks5://1.2.3.4:1080'}, line: 2},
    ]);
  });

  // The failure this whole suite exists for: Excel writes a BOM, it used to
  // become part of the first header key, and every row of a perfectly good file
  // was then rejected for "Missing name".
  it('strips a UTF-8 BOM so the first column keeps its name', () => {
    const [entry] = parseCsv('﻿name,proxy\nAlice,socks5://1.2.3.4:1080');
    expect(entry.row.name).toBe('Alice');
  });

  it('matches headers regardless of case, spaces or dashes', () => {
    const [entry] = parseCsv('Profile Name,Proxy-URL\nAlice,socks5://1.2.3.4:1080');
    expect(entry.row.profile_name).toBe('Alice');
    expect(entry.row.proxy_url).toBe('socks5://1.2.3.4:1080');
  });

  it('keeps the raw header spelling alongside the normalized one', () => {
    const [entry] = parseCsv('Profile Name\nAlice');
    expect(entry.row['Profile Name']).toBe('Alice');
  });

  it('handles quoted fields with commas and doubled quotes', () => {
    const [entry] = parseCsv('name,ua\nAlice,"Mozilla/5.0 (Linux; K), like ""Gecko"""');
    expect(entry.row.ua).toBe('Mozilla/5.0 (Linux; K), like "Gecko"');
  });

  it('handles CRLF', () => {
    expect(parseCsv('name\r\nAlice\r\nBob').map((entry) => entry.row.name))
        .toEqual(['Alice', 'Bob']);
  });

  it('reports the source line of each row', () => {
    expect(parseCsv('name\nAlice\nBob\nCarol').map((entry) => entry.line)).toEqual([2, 3, 4]);
  });

  it('counts newlines inside a quoted field so later lines stay right', () => {
    const [, second] = parseCsv('name,note\nAlice,"two\nlines"\nBob,');
    expect(second.row.name).toBe('Bob');
    expect(second.line).toBe(4);
  });

  it('falls back to semicolons when the header has no commas', () => {
    const [entry] = parseCsv('name;proxy\nAlice;socks5://1.2.3.4:1080');
    expect(entry.row).toEqual({name: 'Alice', proxy: 'socks5://1.2.3.4:1080'});
  });

  it('keeps commas when the header has both', () => {
    const [entry] = parseCsv('name,tags\nAlice,"a; b"');
    expect(entry.row.tags).toBe('a; b');
  });

  it('pads short rows and drops blank ones', () => {
    const rows = parseCsv('name,proxy\nAlice\n\nBob,x');
    expect(rows).toHaveLength(2);
    expect(rows[0].row.proxy).toBe('');
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});

describe('toCsv', () => {
  it('quotes only what needs it, and round-trips through parseCsv', () => {
    const csv = toCsv(['name', 'ua'], [{name: 'Alice', ua: 'a,b'}], (row) => row);
    expect(csv).toBe('name,ua\nAlice,"a,b"');
    expect(parseCsv(csv)[0].row.ua).toBe('a,b');
  });
});
