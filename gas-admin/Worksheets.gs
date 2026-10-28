/**
 * 自訂學習單。
 *
 * 每份學習單有一個固定連結（代碼 W + 6 位數字），放進簡報後就不用再改；
 * 上課前在後台把它「連到」這堂課，作答就算進這堂課。學習單是記名的：作答者填姓名與 Email，
 * 每份作答在抽獎時算一張籤。題目編號規則和公版問卷一樣（刪掉的號碼不再使用）。
 */

var WS_DEFAULT_QUESTIONS = [
  { id: 'q1', type: 'text', label: '請寫下你今天學到的一件事', required: true, maxLength: 500 }
];

function worksheetsSummary_() {
  var count = {}, linked = {};
  table_('ws_responses').rows.forEach(function (r) {
    count[r.ws_id] = (count[r.ws_id] || 0) + 1;
    linked[r.ws_id + '|' + r.course_id] = (linked[r.ws_id + '|' + r.course_id] || 0) + 1;
  });
  return table_('worksheets').rows.map(function (r) {
    return {
      ws_id: r.ws_id, code: r.code, title: r.title, intro: r.intro, status: r.status, course_id: r.course_id,
      questions: parseJson_(r.questions_json, []), response_count: count[r.ws_id] || 0,
      linked_count: linked[r.ws_id + '|' + r.course_id] || 0, created_at: r.created_at, updated_at: r.updated_at
    };
  }).sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });
}

/** 課程詳情最下面列的學習單：目前連到這堂課的，或曾經在這堂課收到作答的 */
function courseWorksheets_(courseId) {
  var count = {};
  table_('ws_responses').rows.forEach(function (r) {
    if (r.course_id === courseId) count[r.ws_id] = (count[r.ws_id] || 0) + 1;
  });
  return table_('worksheets').rows.filter(function (w) { return w.course_id === courseId || count[w.ws_id]; })
    .map(function (w) {
      return { ws_id: w.ws_id, code: w.code, title: w.title, status: w.status, linked: w.course_id === courseId, count: count[w.ws_id] || 0 };
    });
}

function admin_createWorksheet(title) {
  var name = cleanText_(title, 80);
  if (!name) throw new Error('請填學習單名稱');
  return withLock_(function () {
    var t = table_('worksheets');
    var id = 'w' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    var stamp = now_();
    appendObj_(t, {
      ws_id: id, code: newWorksheetCode_(t.rows), title: name, intro: '', status: 'closed', course_id: '',
      questions_json: JSON.stringify(WS_DEFAULT_QUESTIONS), max_q: '1', created_at: stamp, updated_at: stamp
    });
    audit_('create_worksheet', '', name);
    return view_(null, { ws_id: id });
  });
}

function admin_saveWorksheet(wsId, data) {
  data = data || {};
  var title = cleanText_(data.title, 80);
  if (!title) throw new Error('請填學習單名稱');
  return withLock_(function () {
    var t = table_('worksheets');
    var row = worksheetRow_(t, wsId);
    var clean = cleanQuestions_(data.questions, [{ questions_json: row.questions_json }], Number(row.max_q) || 0);
    var maxQ = Math.max(Number(row.max_q) || 0, Math.max.apply(null, clean.map(function (q) { return Number(q.id.slice(1)) || 0; })));
    updateRow_(t, row, {
      title: title, intro: cleanText_(data.intro, 300), questions_json: JSON.stringify(clean),
      max_q: String(maxQ), updated_at: now_()
    });
    return view_(null, { ws_id: wsId });
  });
}

/** 把學習單連到某堂課（courseId 空白＝取消連結）。backTo 給課程詳情用，改完直接回傳那堂課的最新資料 */
function admin_linkWorksheet(wsId, courseId, backTo) {
  return withLock_(function () {
    var t = table_('worksheets');
    var row = worksheetRow_(t, wsId);
    if (courseId) {
      var c = rowById_(table_('courses'), courseId);
      if (c.status === 'closed') throw new Error('這堂課已經結束填答，不能再連學習單');
    }
    updateRow_(t, row, { course_id: courseId || '', updated_at: now_() });
    audit_('link_worksheet', courseId || row.course_id, row.title + (courseId ? ' 連到這堂課' : ' 取消連結'));
    return view_(backTo || null, { ws_id: wsId });
  });
}

function admin_setWorksheetStatus(wsId, status, backTo) {
  if (status !== 'open' && status !== 'closed') throw new Error('狀態不正確');
  return withLock_(function () {
    var t = table_('worksheets');
    var row = worksheetRow_(t, wsId);
    updateRow_(t, row, { status: status, updated_at: now_() });
    audit_(status === 'open' ? 'open_worksheet' : 'close_worksheet', row.course_id, row.title);
    return view_(backTo || null, { ws_id: wsId });
  });
}

function admin_deleteWorksheet(wsId) {
  return withLock_(function () {
    var t = table_('worksheets');
    var row = worksheetRow_(t, wsId);
    if (table_('ws_responses').rows.some(function (r) { return r.ws_id === wsId; })) {
      throw new Error('這份學習單已經有人作答，不能刪除；不想再用可以按「關閉作答」');
    }
    rewriteRows_(t, t.rows.filter(function (r) { return r !== row; }));
    audit_('delete_worksheet', '', row.title);
    return view_(null);
  });
}

/** 某份學習單在某堂課的作答（含姓名，只有講師後台看得到；清除抽獎資料後姓名會是空的） */
function admin_getWorksheetResponses(wsId, courseId) {
  var row = worksheetRow_(table_('worksheets'), wsId);
  var list = table_('ws_responses').rows.filter(function (r) { return r.ws_id === wsId && (!courseId || r.course_id === courseId); });
  return {
    worksheet: { ws_id: row.ws_id, code: row.code, title: row.title, questions: parseJson_(row.questions_json, []) },
    responses: list.slice().reverse().map(function (r) {
      return { submitted_at: r.submitted_at, name: r.name, email: r.email, answers: parseJson_(r.answers_json, {}), prize: r.prize };
    })
  };
}

function worksheetRow_(t, wsId) {
  var row = t.rows.filter(function (r) { return r.ws_id === wsId; })[0];
  if (!row) throw new Error('找不到這份學習單');
  return row;
}

function newWorksheetCode_(rows) {
  var used = rows.map(function (r) { return r.code; });
  for (var i = 0; i < 20; i++) {
    var digits = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000;
    var code = 'W' + ('00000' + digits).slice(-6);
    if (used.indexOf(code) < 0) return code;
  }
  throw new Error('產生學習單代碼失敗，請再試一次');
}
