/**
 * 飛資得講習站｜公開 API（gas-public）
 *
 * 部署：網頁應用程式，執行身分「我」，存取權「任何人」。
 * 這個專案只做三件事：讀取問卷題目、寫入匿名回覆與抽獎登記、回傳統計數字。
 * 程式裡沒有任何讀取或回傳姓名、Email、問卷原始答案的函式：
 * 抽獎登記只讀 course_id、email_hash、prize 三欄，回覆只讀 course_id 一欄，
 * 學習單作答只讀 ws_id、course_id、email_hash 三欄（寫入時才會有姓名與 Email）。
 *
 * 指令碼屬性（專案設定 → 指令碼屬性）：
 *   SPREADSHEET_ID  必填，講習站試算表的 ID
 *   RAFFLE_SECRET   不用填，第一次有人填完問卷時自動產生
 */

var LIMITS = {
  RESPONSES_PER_COURSE: 500,
  ENTRIES_PER_COURSE: 500,
  TEXT_MAX: 500,
  NAME_MAX: 30,
  EMAIL_MAX: 100,
  MIN_SECONDS: 5,
  TOKEN_HOURS: 6
};

var CODE_PATTERN = /^\d{4}-\d{6}$/;
var WS_PATTERN = /^W\d{6}$/;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- 入口 ----------

function doGet() {
  return json_({ ok: true, service: 'training-system public api' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'BAD_REQUEST' });
  }
  var handlers = {
    getSurvey: getSurvey_,
    submitResponse: submitResponse_,
    registerRaffle: registerRaffle_,
    getLive: getLive_,
    getViewer: getViewer_,
    getWorksheet: getWorksheet_,
    submitWorksheet: submitWorksheet_
  };
  var handler = req && handlers[req.action];
  if (!handler) return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  try {
    return json_(handler(req));
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code, field: err.field || undefined });
    console.error(err);
    return json_({ ok: false, error: 'SERVER_ERROR' });
  }
}

// ---------- 五個動作 ----------

function getSurvey_(req) {
  var c = findCourse_(req.survey_code);
  var base = { ok: true, status: c.status, title: c.title };
  if (c.status === 'draft') return base;
  base.date = c.date;
  base.start_time = c.start_time;
  base.org_name = c.org_name;
  base.location = c.location;
  base.prizes = parsePrizes_(c.prizes_json).map(function (p) { return { name: p.name, qty: p.qty }; });
  base.raffle_open = base.prizes.length > 0 && !c.raffle_cleared_at;
  if (c.status === 'open') {
    base.questions = findTemplate_(c.template_version).questions;
  }
  return base;
}

function submitResponse_(req) {
  var c = findCourse_(req.survey_code);
  requireOpen_(c);
  // 隱藏欄位有值 = 機器人，回 ok 但不寫入
  if (req.website) return { ok: true };
  var seconds = Number(req.elapsed);
  if (!(seconds >= LIMITS.MIN_SECONDS)) throw fail_('TOO_FAST');
  var template = findTemplate_(c.template_version);
  var answers = validateAnswers_(template.questions, req.answers);

  return withLock_(function () {
    var sh = sheet_('responses');
    var ids = columnValues_(sh, 'course_id');
    var count = ids.filter(function (id) { return id === c.course_id; }).length;
    if (count >= LIMITS.RESPONSES_PER_COURSE) throw fail_('FULL');
    appendRow_(sh, [Utilities.getUuid(), c.course_id, c.template_version, now_(), JSON.stringify(answers)]);
    return { ok: true, raffle_token: makeToken_(c.course_id) };
  });
}

function registerRaffle_(req) {
  var c = findCourse_(req.survey_code);
  requireOpen_(c);
  if (c.raffle_cleared_at || parsePrizes_(c.prizes_json).length === 0) throw fail_('NO_RAFFLE');
  if (req.consent !== true) throw fail_('CONSENT_REQUIRED');
  var nonce = verifyToken_(req.raffle_token, c.course_id);

  var name = String(req.name == null ? '' : req.name).trim().replace(/\s+/g, ' ');
  var nameLength = Array.from(name).length;
  if (nameLength < 1 || nameLength > LIMITS.NAME_MAX) throw fail_('INVALID_NAME');
  var email = String(req.email == null ? '' : req.email).trim().toLowerCase();
  if (email.length > LIMITS.EMAIL_MAX || !EMAIL_PATTERN.test(email)) throw fail_('INVALID_EMAIL');
  var hash = sha256Hex_(c.course_id + '|' + email);

  return withLock_(function () {
    var sh = sheet_('raffle_entries');
    var ids = columnValues_(sh, 'course_id');
    var hashes = columnValues_(sh, 'email_hash');
    var count = 0;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] !== c.course_id) continue;
      count++;
      if (hashes[i] === hash) throw fail_('DUPLICATE');
    }
    if (count >= LIMITS.ENTRIES_PER_COURSE) throw fail_('FULL');
    var t = now_();
    appendRow_(sh, [Utilities.getUuid(), c.course_id, name, email, t, t, '', '', hash]);
    CacheService.getScriptCache().put('used:' + nonce, '1', LIMITS.TOKEN_HOURS * 3600);
    return { ok: true };
  });
}

function getLive_(req) {
  var c = findCourse_(req.survey_code);
  if (c.status === 'draft') return { ok: true, status: 'draft', title: c.title };

  var responseIds = columnValues_(sheet_('responses'), 'course_id');
  var responseCount = responseIds.filter(function (id) { return id === c.course_id; }).length;

  var entries = sheet_('raffle_entries');
  var entryIds = columnValues_(entries, 'course_id');
  var entryPrizes = columnValues_(entries, 'prize');
  var entryCount = 0;
  var drawn = {};
  for (var i = 0; i < entryIds.length; i++) {
    if (entryIds[i] !== c.course_id) continue;
    entryCount++;
    if (entryPrizes[i]) drawn[entryPrizes[i]] = (drawn[entryPrizes[i]] || 0) + 1;
  }
  if (c.raffle_cleared_at) entryCount = Number(c.raffle_count_final) || 0;

  return {
    ok: true,
    status: c.status,
    title: c.title,
    date: c.date,
    org_name: c.org_name,
    location: c.location,
    response_count: responseCount,
    entry_count: entryCount,
    prizes: parsePrizes_(c.prizes_json).map(function (p) {
      return { name: p.name, qty: p.qty, drawn: drawn[p.name] || 0 };
    })
  };
}

/** 草稿課程也能看簡報（上課開頭還沒開放填答時就要放），問卷才要等開放 */
function getViewer_(req) {
  var c = findCourse_(req.survey_code);
  return {
    ok: true,
    status: c.status,
    title: c.title,
    date: c.date,
    org_name: c.org_name,
    slide_type: c.slide_type,
    slide_url: c.slide_url
  };
}

// ---------- 學習單（記名作答） ----------

/** 學習單能不能作答：自己是開放的、有連到課程、那堂課還沒結束填答 */
function worksheetState_(ws) {
  if (ws.status !== 'open') return { state: 'closed' };
  if (!ws.course_id) return { state: 'no_course' };
  var c = readRows_('courses').filter(function (r) { return r.course_id === ws.course_id; })[0];
  if (!c) return { state: 'no_course' };
  if (c.status === 'closed') return { state: 'closed', course: c };
  return { state: 'open', course: c };
}

function getWorksheet_(req) {
  var ws = findWorksheet_(req.code);
  var st = worksheetState_(ws);
  var out = { ok: true, state: st.state, title: ws.title, intro: ws.intro };
  if (st.course) {
    out.course_title = st.course.title;
    out.course_date = st.course.date;
  }
  if (st.state === 'open') out.questions = JSON.parse(ws.questions_json || '[]');
  return out;
}

function submitWorksheet_(req) {
  var ws = findWorksheet_(req.code);
  var st = worksheetState_(ws);
  if (st.state === 'closed') throw fail_('CLOSED');
  if (st.state !== 'open') throw fail_('NOT_OPEN');
  if (req.website) return { ok: true };
  if (!(Number(req.elapsed) >= LIMITS.MIN_SECONDS)) throw fail_('TOO_FAST');
  if (req.consent !== true) throw fail_('CONSENT_REQUIRED');
  var name = String(req.name == null ? '' : req.name).trim().replace(/\s+/g, ' ');
  var nameLength = Array.from(name).length;
  if (nameLength < 1 || nameLength > LIMITS.NAME_MAX) throw fail_('INVALID_NAME');
  var email = String(req.email == null ? '' : req.email).trim().toLowerCase();
  if (email.length > LIMITS.EMAIL_MAX || !EMAIL_PATTERN.test(email)) throw fail_('INVALID_EMAIL');
  var answers = validateAnswers_(JSON.parse(ws.questions_json || '[]'), req.answers);
  var courseId = st.course.course_id;
  var hash = sha256Hex_(ws.ws_id + '|' + courseId + '|' + email);

  return withLock_(function () {
    var sh = sheet_('ws_responses');
    var wsIds = columnValues_(sh, 'ws_id');
    var courseIds = columnValues_(sh, 'course_id');
    var hashes = columnValues_(sh, 'email_hash');
    var count = 0;
    for (var i = 0; i < wsIds.length; i++) {
      if (wsIds[i] !== ws.ws_id || courseIds[i] !== courseId) continue;
      count++;
      if (hashes[i] === hash) throw fail_('DUPLICATE');
    }
    if (count >= LIMITS.RESPONSES_PER_COURSE) throw fail_('FULL');
    appendRow_(sh, [Utilities.getUuid(), ws.ws_id, courseId, now_(), name, email, hash, JSON.stringify(answers), '', '']);
    return { ok: true };
  });
}

function findWorksheet_(code) {
  code = String(code || '').trim().toUpperCase();
  if (!WS_PATTERN.test(code)) throw fail_('NOT_FOUND');
  var ws = readRows_('worksheets').filter(function (r) { return r.code === code; })[0];
  if (!ws) throw fail_('NOT_FOUND');
  return ws;
}

// ---------- 驗證 ----------

function validateAnswers_(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw fail_('INVALID');
  var out = {};
  questions.forEach(function (q) {
    var v = answers[q.id];
    var empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (q.type === 'text' && typeof v === 'string' && v.trim() === '') empty = true;
    if (empty) {
      if (q.required) throw fail_('REQUIRED', q.id);
      return;
    }
    switch (q.type) {
      case 'rating':
        var n = Number(v);
        if (!(n % 1 === 0 && n >= 1 && n <= 5)) throw fail_('INVALID', q.id);
        out[q.id] = n;
        break;
      case 'single':
        if (typeof v !== 'string' || q.options.indexOf(v) < 0) throw fail_('INVALID', q.id);
        out[q.id] = v;
        break;
      case 'multi':
        if (!Array.isArray(v)) throw fail_('INVALID', q.id);
        v.forEach(function (x) {
          if (typeof x !== 'string' || q.options.indexOf(x) < 0) throw fail_('INVALID', q.id);
        });
        out[q.id] = q.options.filter(function (o) { return v.indexOf(o) >= 0; });
        break;
      case 'yesno':
        if (v !== '是' && v !== '否') throw fail_('INVALID', q.id);
        out[q.id] = v;
        break;
      case 'text':
        if (typeof v !== 'string') throw fail_('INVALID', q.id);
        var text = v.trim();
        var max = Math.min(Number(q.maxLength) || LIMITS.TEXT_MAX, LIMITS.TEXT_MAX);
        if (Array.from(text).length > max) throw fail_('TOO_LONG', q.id);
        out[q.id] = text;
        break;
      default:
        throw fail_('INVALID', q.id);
    }
  });
  return out;
}

function requireOpen_(c) {
  if (c.status === 'closed') throw fail_('CLOSED');
  if (c.status !== 'open') throw fail_('NOT_OPEN');
}

// ---------- 抽獎憑證：證明填過問卷，但不記錄是哪一份 ----------

function makeToken_(courseId) {
  var expires = Date.now() + LIMITS.TOKEN_HOURS * 3600 * 1000;
  var payload = courseId + '.' + expires + '.' + Utilities.getUuid().replace(/-/g, '');
  return payload + '.' + sign_(payload);
}

function verifyToken_(token, courseId) {
  var parts = String(token || '').split('.');
  if (parts.length !== 4) throw fail_('BAD_TOKEN');
  var payload = parts.slice(0, 3).join('.');
  if (parts[0] !== courseId || sign_(payload) !== parts[3]) throw fail_('BAD_TOKEN');
  if (Number(parts[1]) < Date.now()) throw fail_('TOKEN_EXPIRED');
  if (CacheService.getScriptCache().get('used:' + parts[2])) throw fail_('TOKEN_USED');
  return parts[2];
}

function sign_(payload) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('RAFFLE_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('RAFFLE_SECRET', secret);
  }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret));
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// ---------- 試算表 ----------

function ss_() {
  if (!ss_.cache) {
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw fail_('NOT_CONFIGURED');
    ss_.cache = SpreadsheetApp.openById(id);
  }
  return ss_.cache;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw fail_('NOT_SETUP');
  return sh;
}

/** 同一次呼叫裡每張表的欄位名稱只讀一次 */
var HEADERS_ = {};
function headers_(sh) {
  var name = sh.getName();
  if (!HEADERS_[name]) HEADERS_[name] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  return HEADERS_[name];
}

/** 只讀一欄。公開 API 不讀整張抽獎表，所以姓名與 Email 欄從未被載入。 */
function columnValues_(sh, key) {
  var col = headers_(sh).indexOf(key) + 1;
  if (col < 1) throw fail_('NOT_SETUP');
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, col, last - 1, 1).getValues().map(function (r) { return cell_(r[0]); });
}

/** 課程、公版問卷、學習單題目是公開資訊，可以整列讀；其他分頁（有姓名、答案的）一律不行。 */
function readRows_(name) {
  if (name !== 'courses' && name !== 'templates' && name !== 'worksheets') throw fail_('FORBIDDEN');
  var values = sheet_(name).getDataRange().getValues();
  var head = values[0].map(String);
  return values.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (k, j) { o[k] = cell_(r[j]); });
    return o;
  });
}

function findCourse_(code) {
  code = String(code || '').trim();
  if (!CODE_PATTERN.test(code)) throw fail_('NOT_FOUND');
  var c = readRows_('courses').filter(function (r) { return r.survey_code === code; })[0];
  if (!c) throw fail_('NOT_FOUND');
  return c;
}

function findTemplate_(version) {
  var t = readRows_('templates').filter(function (r) { return String(r.version) === String(version); })[0];
  if (!t) throw fail_('NOT_SETUP');
  return { version: t.version, questions: JSON.parse(t.questions_json) };
}

function parsePrizes_(text) {
  try {
    var list = JSON.parse(text || '[]');
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function appendRow_(sh, values) {
  var row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  sh.getRange(row, 1, 1, values.length).setNumberFormat('@').setValues([values.map(safeCell_)]);
}

/** 防公式注入：= + - @ 開頭的文字前面加單引號 */
function safeCell_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return v === null || v === undefined ? '' : String(v);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw fail_('BUSY');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function fail_(code, field) {
  return { code: code, field: field };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
