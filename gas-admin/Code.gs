/**
 * 飛資得講習站｜講師後台（gas-admin）
 *
 * 綁定在講習站試算表上。部署：網頁應用程式，執行身分「我」，存取權「僅限自己」。
 * 未登入或用其他 Google 帳號開啟時，Google 會直接拒絕，這裡不用處理登入。
 * 前端（Index.html）用 google.script.run 呼叫下面 admin_ 開頭的函式。
 *
 * 指令碼屬性（選填）：
 *   SITE_URL        GitHub Pages 網址，預設 https://emilychen1212.github.io/training-system/
 *   PUBLIC_API_URL  公開 API 網址，只有 runSelfTest() 會用到
 */

var DEFAULT_SITE_URL = 'https://emilychen1212.github.io/training-system/';
var ORG_TYPES = ['學校', '醫院', '其他'];
var DEFAULT_TAGS = ['JoVE', 'VisualDx', 'Thieme', 'Ovid', 'LWW', 'Rayyan', 'UpToDate'];
var RAFFLE_KEEP_DAYS = 30;

// ---------- 網頁入口 ----------

function doGet(e) {
  var p = (e && e.parameter) || {};
  var t = HtmlService.createTemplateFromFile('Index');
  t.initial = JSON.stringify({ page: String(p.page || ''), code: String(p.c || '') });
  return t.evaluate()
    .setTitle('飛資得講習站｜講師後台')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ---------- 給前端呼叫的函式 ----------

function admin_bootstrap() {
  var ss = SpreadsheetApp.getActive();
  var courses = listCourses_();
  var tags = DEFAULT_TAGS.slice();
  courses.forEach(function (c) {
    c.product_tags.forEach(function (tag) { if (tags.indexOf(tag) < 0) tags.push(tag); });
  });
  return {
    siteUrl: siteUrl_(),
    spreadsheetUrl: ss.getUrl(),
    responsesUrl: ss.getUrl() + '#gid=' + ss.getSheetByName('responses').getSheetId(),
    productTags: tags,
    orgTypes: ORG_TYPES,
    courses: courses,
    reminders: courses.filter(needsCleanup_).map(function (c) {
      return { course_id: c.course_id, title: c.title, date: c.date, entries: c.entry_count };
    })
  };
}

function admin_getCourse(courseId) {
  var c = findCourse_(courseId);
  var questions = findTemplate_(c.template_version).questions;
  var responses = table_('responses').rows.filter(function (r) { return r.course_id === c.course_id; });
  var latest = responses.slice(-20).reverse().map(function (r) {
    return { submitted_at: r.submitted_at, answers: parseJson_(r.answers_json, {}) };
  });
  return {
    course: c,
    questions: questions,
    latest: latest,
    raffle: raffleSummary_(c)
  };
}

function admin_saveCourse(input) {
  var d = cleanCourseInput_(input || {});
  return withLock_(function () {
    var t = table_('courses');
    var stamp = now_();
    if (input.course_id) {
      var row = t.rows.filter(function (r) { return r.course_id === input.course_id; })[0];
      if (!row) throw new Error('找不到這堂課');
      checkPrizeChange_(row, d.prizes);
      updateRow_(t, row, {
        title: d.title, date: d.date, start_time: d.start_time, org_name: d.org_name,
        org_type: d.org_type, location: d.location, product_tags: d.product_tags.join(','),
        attendees: d.attendees, prizes_json: JSON.stringify(d.prizes), updated_at: stamp
      });
      return row.course_id;
    }
    var id = 'c' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    appendObj_(t, {
      course_id: id, title: d.title, date: d.date, start_time: d.start_time, org_name: d.org_name,
      org_type: d.org_type, location: d.location, product_tags: d.product_tags.join(','),
      attendees: d.attendees, status: 'draft', template_version: publishedVersion_(),
      survey_code: newSurveyCode_(d.date, t.rows), slide_type: '', slide_url: '',
      prizes_json: JSON.stringify(d.prizes), created_at: stamp, updated_at: stamp
    });
    audit_('create_course', id, d.title);
    return id;
  });
}

function admin_setAttendees(courseId, value) {
  var n = cleanCount_(value);
  return withLock_(function () {
    var t = table_('courses');
    var row = rowById_(t, courseId);
    updateRow_(t, row, { attendees: n, updated_at: now_() });
    return n;
  });
}

function admin_setStatus(courseId, status) {
  return withLock_(function () {
    var t = table_('courses');
    var row = rowById_(t, courseId);
    var counts = courseCounts_()[courseId] || { responses: 0, winners: 0 };
    var from = row.status;
    var ok = (from === 'draft' && status === 'open') ||
      (from === 'open' && status === 'closed') ||
      (from === 'open' && status === 'draft' && counts.responses === 0) ||
      (from === 'closed' && status === 'open' && counts.winners === 0 && !row.raffle_cleared_at);
    if (!ok) {
      if (from === 'closed' && status === 'open') throw new Error('已經開始抽獎或清除過抽獎資料，不能重新開放填答');
      if (status === 'draft') throw new Error('已經有人填答，不能改回草稿');
      throw new Error('目前狀態不能這樣切換');
    }
    updateRow_(t, row, { status: status, updated_at: now_() });
    var action = { open: 'open_survey', closed: 'close_survey', draft: 'back_to_draft' }[status];
    audit_(action, courseId, from + ' → ' + status);
    return status;
  });
}

function admin_deleteCourse(courseId) {
  return withLock_(function () {
    var t = table_('courses');
    var row = rowById_(t, courseId);
    var counts = courseCounts_()[courseId] || { responses: 0, entries: 0 };
    if (counts.responses > 0 || counts.entries > 0) throw new Error('已經有填答或抽獎登記，不能刪除這堂課');
    t.sh.deleteRow(row._row);
    audit_('delete_course', courseId, row.title);
    return true;
  });
}

function admin_getRaffle(courseIdOrCode) {
  var key = String(courseIdOrCode || '');
  var c = table_('courses').rows.filter(function (r) {
    return r.course_id === key || r.survey_code === key;
  })[0];
  if (!c) throw new Error('找不到這堂課');
  return { course: publicCourse_(c), raffle: raffleSummary_(c) };
}

function admin_draw(courseId, prizeName) {
  return withLock_(function () {
    var c = findCourse_(courseId);
    if (c.status !== 'closed') throw new Error('請先「結束填答」，名單凍結後才能抽獎');
    if (c.raffle_cleared_at) throw new Error('這堂課的抽獎資料已經清除');
    var prize = parseJson_(c.prizes_json, []).filter(function (p) { return p.name === prizeName; })[0];
    if (!prize) throw new Error('找不到這個獎項');

    var t = table_('raffle_entries');
    var mine = t.rows.filter(function (r) { return r.course_id === c.course_id; });
    var drawnCount = mine.filter(function (r) { return r.prize === prize.name; }).length;
    if (drawnCount >= prize.qty) throw new Error('這個獎項已經抽滿了');
    var pool = mine.filter(function (r) { return !r.prize; });
    if (!pool.length) throw new Error('已經沒有還沒中獎的人可以抽了');

    var pick = pool[Math.floor(Math.random() * pool.length)];
    updateRow_(t, pick, { prize: prize.name, drawn_at: now_('yyyy-MM-dd HH:mm:ss.SSS') });
    audit_('draw', c.course_id, prize.name + ' 第 ' + (drawnCount + 1) + ' 位');

    return {
      course: c,
      raffle: raffleSummary_(c),
      winner: { prize: prize.name, no: drawnCount + 1, name: maskName_(pick.name), email: maskEmail_(pick.email) }
    };
  });
}

function admin_exportRaffle(courseId) {
  var c = findCourse_(courseId);
  if (c.raffle_cleared_at) throw new Error('這堂課的抽獎資料已經清除，沒有名單可以匯出');
  var mine = table_('raffle_entries').rows.filter(function (r) { return r.course_id === c.course_id; });
  mine.sort(function (a, b) {
    if (!!a.prize !== !!b.prize) return a.prize ? -1 : 1;
    return (a.drawn_at || a.created_at) < (b.drawn_at || b.created_at) ? -1 : 1;
  });
  var lines = [['獎項', '姓名', 'Email', '登記時間', '抽出時間']].concat(mine.map(function (r) {
    return [r.prize || '（未中獎）', r.name, r.email, r.created_at, r.drawn_at];
  }));
  audit_('export_raffle', c.course_id, mine.length + ' 筆');
  return {
    filename: '抽獎名單_' + c.date + '_' + c.title.replace(/[\\\/:*?"<>|]/g, '') + '.csv',
    csv: '﻿' + lines.map(function (cols) { return cols.map(csvCell_).join(','); }).join('\r\n')
  };
}

function admin_clearRaffle(courseId, confirmText) {
  if (confirmText !== '清除') throw new Error('請輸入「清除」兩個字確認');
  return withLock_(function () {
    var courses = table_('courses');
    var c = rowById_(courses, courseId);
    if (c.status !== 'closed') throw new Error('請先結束填答，再清除抽獎資料');
    if (c.raffle_cleared_at) throw new Error('這堂課已經清除過了');
    var t = table_('raffle_entries');
    var mine = t.rows.filter(function (r) { return r.course_id === c.course_id; });
    var winners = mine.filter(function (r) { return r.prize; }).length;
    rewriteRows_(t, t.rows.filter(function (r) { return r.course_id !== c.course_id; }));
    updateRow_(courses, c, {
      raffle_count_final: mine.length, winner_count_final: winners,
      raffle_cleared_at: now_(), updated_at: now_()
    });
    audit_('clear_raffle', c.course_id, '刪除 ' + mine.length + ' 筆登記（得獎 ' + winners + ' 位）');
    return { entries: mine.length, winners: winners };
  });
}

// ---------- 課程資料 ----------

function listCourses_() {
  var counts = courseCounts_();
  return table_('courses').rows.map(function (r) {
    var c = publicCourse_(r);
    var n = counts[r.course_id] || { responses: 0, entries: 0, winners: 0, q1sum: 0, q1n: 0 };
    c.response_count = n.responses;
    c.entry_count = r.raffle_cleared_at ? Number(r.raffle_count_final) || 0 : n.entries;
    c.winner_count = r.raffle_cleared_at ? Number(r.winner_count_final) || 0 : n.winners;
    c.live_entries = n.entries;
    c.avg_q1 = n.q1n ? Math.round(n.q1sum / n.q1n * 10) / 10 : null;
    return c;
  }).sort(function (a, b) {
    return (b.date + b.start_time).localeCompare(a.date + a.start_time);
  });
}

function findCourse_(courseId) {
  var c = listCourses_().filter(function (r) { return r.course_id === courseId; })[0];
  if (!c) throw new Error('找不到這堂課');
  return c;
}

function publicCourse_(r) {
  return {
    course_id: r.course_id, title: r.title, date: r.date, start_time: r.start_time,
    org_name: r.org_name, org_type: r.org_type, location: r.location,
    product_tags: r.product_tags ? r.product_tags.split(',') : [],
    attendees: r.attendees === '' ? '' : Number(r.attendees),
    status: r.status, template_version: r.template_version, survey_code: r.survey_code,
    slide_type: r.slide_type, slide_url: r.slide_url,
    prizes: parseJson_(r.prizes_json, []), prizes_json: r.prizes_json,
    raffle_cleared_at: r.raffle_cleared_at,
    raffle_count_final: r.raffle_count_final, winner_count_final: r.winner_count_final,
    created_at: r.created_at, updated_at: r.updated_at
  };
}

function courseCounts_() {
  var out = {};
  function get(id) {
    return out[id] || (out[id] = { responses: 0, entries: 0, winners: 0, q1sum: 0, q1n: 0 });
  }
  table_('responses').rows.forEach(function (r) {
    var n = get(r.course_id);
    n.responses++;
    var q1 = Number(parseJson_(r.answers_json, {}).q1);
    if (q1 >= 1 && q1 <= 5) { n.q1sum += q1; n.q1n++; }
  });
  table_('raffle_entries').rows.forEach(function (r) {
    var n = get(r.course_id);
    n.entries++;
    if (r.prize) n.winners++;
  });
  return out;
}

function raffleSummary_(c) {
  var mine = c.raffle_cleared_at ? [] :
    table_('raffle_entries').rows.filter(function (r) { return r.course_id === c.course_id; });
  var prizes = (c.prizes || parseJson_(c.prizes_json, [])).map(function (p) {
    var winners = mine.filter(function (r) { return r.prize === p.name; })
      .sort(function (a, b) { return a.drawn_at < b.drawn_at ? -1 : 1; })
      .map(function (r, i) { return { no: i + 1, name: maskName_(r.name), email: maskEmail_(r.email) }; });
    return { name: p.name, qty: p.qty, winners: winners };
  });
  return {
    frozen: c.status === 'closed',
    cleared: !!c.raffle_cleared_at,
    entry_count: c.raffle_cleared_at ? Number(c.raffle_count_final) || 0 : mine.length,
    winner_count: c.raffle_cleared_at ? Number(c.winner_count_final) || 0 :
      mine.filter(function (r) { return r.prize; }).length,
    remaining: mine.filter(function (r) { return !r.prize; }).length,
    prizes: prizes
  };
}

function needsCleanup_(c) {
  if (c.raffle_cleared_at || !c.live_entries) return false;
  var limit = new Date(c.date + 'T00:00:00');
  limit.setDate(limit.getDate() + RAFFLE_KEEP_DAYS);
  return new Date() > limit;
}

function cleanCourseInput_(d) {
  var title = cleanText_(d.title, 80);
  if (!title) throw new Error('請填課程名稱');
  var date = String(d.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00'))) throw new Error('日期格式不正確');
  var time = String(d.start_time || '');
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('時間格式不正確');
  var orgType = ORG_TYPES.indexOf(d.org_type) >= 0 ? d.org_type : '其他';
  var tags = (Array.isArray(d.product_tags) ? d.product_tags : [])
    .map(function (x) { return cleanText_(x, 20).replace(/,/g, ' '); })
    .filter(function (x, i, arr) { return x && arr.indexOf(x) === i; })
    .slice(0, 8);
  var prizes = (Array.isArray(d.prizes) ? d.prizes : []).map(function (p) {
    var name = cleanText_(p && p.name, 40);
    var qty = Number(p && p.qty);
    if (!name) throw new Error('獎項名稱不能空白');
    if (!(qty % 1 === 0 && qty >= 1 && qty <= 100)) throw new Error('「' + name + '」的數量要是 1～100 的整數');
    return { name: name, qty: qty };
  });
  if (prizes.length > 10) throw new Error('獎項最多 10 個');
  prizes.forEach(function (p, i) {
    if (prizes.findIndex(function (x) { return x.name === p.name; }) !== i) throw new Error('獎項名稱重複：' + p.name);
  });
  return {
    title: title, date: date, start_time: time,
    org_name: cleanText_(d.org_name, 60), org_type: orgType, location: cleanText_(d.location, 60),
    product_tags: tags, attendees: cleanCount_(d.attendees), prizes: prizes
  };
}

function checkPrizeChange_(row, prizes) {
  var drawn = {};
  table_('raffle_entries').rows.forEach(function (r) {
    if (r.course_id === row.course_id && r.prize) drawn[r.prize] = (drawn[r.prize] || 0) + 1;
  });
  Object.keys(drawn).forEach(function (name) {
    var p = prizes.filter(function (x) { return x.name === name; })[0];
    if (!p || p.qty < drawn[name]) {
      throw new Error('「' + name + '」已經抽出 ' + drawn[name] + ' 位，不能刪除或改名，數量也不能少於 ' + drawn[name]);
    }
  });
}

function cleanText_(v, max) {
  return Array.from(String(v == null ? '' : v).trim().replace(/\s+/g, ' ')).slice(0, max).join('');
}

function cleanCount_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  if (!(n % 1 === 0 && n >= 0 && n <= 5000)) throw new Error('實到人數要是 0～5000 的整數');
  return n;
}

function newSurveyCode_(date, rows) {
  var used = rows.map(function (r) { return r.survey_code; });
  var mmdd = date.slice(5, 7) + date.slice(8, 10);
  for (var i = 0; i < 20; i++) {
    var digits = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000;
    var code = mmdd + '-' + ('00000' + digits).slice(-6);
    if (used.indexOf(code) < 0) return code;
  }
  throw new Error('產生問卷代碼失敗，請再試一次');
}

function publishedVersion_() {
  var t = table_('templates').rows.filter(function (r) { return r.status === 'published'; })[0];
  if (!t) throw new Error('沒有使用中的公版問卷，請先執行 setupSheets');
  return t.version;
}

function findTemplate_(version) {
  var t = table_('templates').rows.filter(function (r) { return String(r.version) === String(version); })[0];
  if (!t) throw new Error('找不到公版問卷 v' + version);
  return { version: t.version, questions: parseJson_(t.questions_json, []) };
}

function siteUrl_() {
  var url = PropertiesService.getScriptProperties().getProperty('SITE_URL') || DEFAULT_SITE_URL;
  return url.replace(/\/?$/, '/');
}

// ---------- 遮罩 ----------

/** 王小明 → 王○明；王明 → 王○；長名字中間一律只放一個 ○，不洩露字數 */
function maskName_(name) {
  var ch = Array.from(String(name || '').trim());
  if (ch.length === 0) return '';
  if (ch.length <= 2) return ch[0] + '○';
  return ch[0] + '○' + ch[ch.length - 1];
}

/** mingwang@gmail.com → mi***@gmail.com */
function maskEmail_(email) {
  var s = String(email || '');
  var at = s.lastIndexOf('@');
  if (at < 1) return '***';
  var local = s.slice(0, at);
  return (local.length > 2 ? local.slice(0, 2) : local.slice(0, 1)) + '***' + s.slice(at);
}

// ---------- 試算表工具 ----------

function table_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('試算表還沒初始化，請先在 Apps Script 執行 setupSheets');
  var values = sh.getDataRange().getValues();
  var head = values[0].map(String);
  var rows = values.slice(1).map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (k, j) { o[k] = cell_(r[j]); });
    return o;
  }).filter(function (o) {
    return head.some(function (k) { return o[k] !== ''; });
  });
  return { sh: sh, head: head, rows: rows };
}

function rowById_(t, courseId) {
  var row = t.rows.filter(function (r) { return r.course_id === courseId; })[0];
  if (!row) throw new Error('找不到這堂課');
  return row;
}

function updateRow_(t, row, patch) {
  Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
  t.sh.getRange(row._row, 1, 1, t.head.length).setNumberFormat('@')
    .setValues([t.head.map(function (k) { return safeCell_(row[k] == null ? '' : row[k]); })]);
}

function appendObj_(t, obj) {
  appendRow_(t.sh, t.head.map(function (k) { return obj[k] == null ? '' : obj[k]; }));
}

function appendRow_(sh, values) {
  var row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  sh.getRange(row, 1, 1, values.length).setNumberFormat('@').setValues([values.map(safeCell_)]);
}

/** 用剩下的資料整片覆寫，比一列一列刪快很多 */
function rewriteRows_(t, keep) {
  var width = t.head.length;
  var last = t.sh.getLastRow();
  if (last >= 2) t.sh.getRange(2, 1, last - 1, width).clearContent();
  if (keep.length) {
    t.sh.getRange(2, 1, keep.length, width).setNumberFormat('@').setValues(keep.map(function (r) {
      return t.head.map(function (k) { return safeCell_(r[k] == null ? '' : r[k]); });
    }));
  }
}

function audit_(action, courseId, detail) {
  appendRow_(SpreadsheetApp.getActive().getSheetByName('audit_log'), [now_(), action, courseId || '', detail || '']);
}

/** 防公式注入：= + - @ 開頭的文字前面加單引號 */
function safeCell_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function csvCell_(v) {
  var s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return v === null || v === undefined ? '' : String(v);
}

function parseJson_(text, fallback) {
  try {
    var v = JSON.parse(text);
    return v == null ? fallback : v;
  } catch (err) {
    return fallback;
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('系統忙碌中，請稍後再試');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function now_(pattern) {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), pattern || 'yyyy-MM-dd HH:mm:ss');
}
