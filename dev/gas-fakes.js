/*
 * 本機測試用：模擬 Apps Script 的試算表、指令碼屬性、鎖、快取等服務，
 * 讓 gas-public 與 gas-admin 的原始碼不用上傳就能在電腦上跑。只在開發時使用。
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
    if (row < 1 || col < 1 || rows < 1 || cols < 1) throw new Error(`Range out of bounds ${row},${col},${rows},${cols}`);
    if (row + rows - 1 > sheet.maxRows) throw new Error('Range rows exceed sheet size');
  }
  each(fn) {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) fn(this.row - 1 + r, this.col - 1 + c, r, c);
  }
  getValues() {
    const out = Array.from({ length: this.rows }, () => new Array(this.cols).fill(''));
    this.each((R, C, r, c) => {
      const cell = this.sheet.cells[R] && this.sheet.cells[R][C];
      out[r][c] = !cell ? '' : cell.formula ? '#公式被執行了' : cell.value;
    });
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  getFormula() {
    const cell = this.sheet.cells[this.row - 1] && this.sheet.cells[this.row - 1][this.col - 1];
    return cell && cell.formula ? cell.formula : '';
  }
  setValues(values) {
    if (values.length !== this.rows || values.some((r) => r.length !== this.cols)) throw new Error('setValues 尺寸不符');
    this.each((R, C, r, c) => this.sheet.put(R, C, values[r][c], this.sheet.isText(C)));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(fmt) {
    if (fmt === '@') for (let c = 0; c < this.cols; c++) this.sheet.textCols.add(this.col - 1 + c);
    return this;
  }
  clearContent() { this.each((R, C) => { if (this.sheet.cells[R]) this.sheet.cells[R][C] = undefined; }); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class FakeSheet {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.cells = [];
    this.maxRows = 1000;
    this.textCols = new Set();
  }
  isText(col) { return this.textCols.has(col); }
  put(R, C, v, asText) {
    this.cells[R] = this.cells[R] || [];
    if (v === '' || v === null || v === undefined) { this.cells[R][C] = undefined; return; }
    if (typeof v === 'string' && v[0] === "'") { this.cells[R][C] = { value: v.slice(1) }; return; }
    if (typeof v === 'string' && v[0] === '=') { this.cells[R][C] = { formula: v }; return; }
    this.cells[R][C] = { value: asText ? String(v) : v };
  }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) if (this.cells[r] && this.cells[r].some(Boolean)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.cells.forEach((row) => row && row.forEach((c, i) => { if (c) max = Math.max(max, i + 1); }));
    return max;
  }
  getRange(row, col, rows = 1, cols = 1) { return new FakeRange(this, row, col, rows, cols); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  setFrozenRows() {}
  deleteRow(r) { this.cells.splice(r - 1, 1); }
}

class FakeSpreadsheet {
  constructor() {
    this.id = 'FAKE_SPREADSHEET_ID';
    this.sheets = [new FakeSheet('工作表1', 0)];
    this.nextId = 1;
  }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n, this.nextId++); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

function signedBytes(buf) { return Array.from(buf, (b) => (b > 127 ? b - 256 : b)); }

function formatDate(date, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const ms = ('00' + date.getMilliseconds()).slice(-3);
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss|SSS/g, (t) => ({
    yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second, SSS: ms
  }[t]));
}

function makeProject(ss, files, extra) {
  const props = new Map();
  const cache = new Map();
  const ctx = {
    console, JSON, Math, Date, Array, Object, String, Number, RegExp, Error, isNaN, parseInt,
    SpreadsheetApp: { openById: (id) => { if (id !== ss.id) throw new Error('bad id'); return ss; }, getActive: () => ss },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); }
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => { cache.set(k, v); } }) },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    Logger: { log: (m) => { ctx.__log.push(String(m)); } },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate,
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => signedBytes(crypto.createHash(alg).update(text, 'utf8').digest()),
      computeHmacSha256Signature: (value, key) => signedBytes(crypto.createHmac('sha256', key).update(value, 'utf8').digest()),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => b & 0xff)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } })
    },
    __log: [],
    ...extra
  };
  vm.createContext(ctx);
  files.forEach((f) => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: path.basename(f) }));
  ctx.__props = props;
  return ctx;
}

function renderTemplate(dir, name, vars, injectHead) {
  const read = (n) => fs.readFileSync(path.join(dir, n + '.html'), 'utf8');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  let html = read(name)
    .replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, (m, n) => read(n))
    .replace(/<\?=\s*(\w+)\s*\?>/g, (m, v) => esc(vars[v]));
  return html.replace('<head>', '<head>' + injectHead);
}

module.exports = { FakeSpreadsheet, makeProject, renderTemplate };
