/**
 * 公版問卷與版本控制。
 *
 * 版本狀態只有三種：draft（草稿）、published（使用中）、archived（已封存），同時最多一個草稿、一個使用中。
 * 只有草稿可以編輯；要改題目時，從任一版「複製成草稿」。
 * 題目 id 跨版本沿用（統計靠 id 合併），新題目取下一個沒用過的號碼，刪掉的號碼不再使用。
 */

var Q_TYPES = ['rating', 'single', 'multi', 'rank', 'yesno', 'text'];
var TPL_LIMITS = { QUESTIONS_MIN: 1, QUESTIONS_MAX: 15, OPTIONS_MIN: 2, OPTIONS_MAX: 20, RANK_MAX: 8, OPTION_LEN: 100, LABEL_LEN: 100, END_LEN: 20, NOTE_LEN: 100 };

function templatesSummary_() {
  var usage = {};
  table_('courses').rows.forEach(function (r) { usage[r.template_version] = (usage[r.template_version] || 0) + 1; });
  return table_('templates').rows.map(function (r) {
    return {
      version: Number(r.version), status: r.status, change_note: r.change_note, published_at: r.published_at,
      questions: parseJson_(r.questions_json, []), course_count: usage[r.version] || 0
    };
  }).sort(function (a, b) { return b.version - a.version; });
}

function admin_copyToDraft(version) {
  return withLock_(function () {
    var t = table_('templates');
    if (t.rows.some(function (r) { return r.status === 'draft'; })) throw new Error('已經有一份草稿了，請先發布或刪除它');
    var src = t.rows.filter(function (r) { return String(r.version) === String(version); })[0];
    if (!src) throw new Error('找不到 v' + version);
    var next = Math.max.apply(null, t.rows.map(function (r) { return Number(r.version) || 0; })) + 1;
    appendObj_(t, { version: String(next), status: 'draft', questions_json: src.questions_json, change_note: '', published_at: '' });
    audit_('copy_template', '', 'v' + src.version + ' 複製成 v' + next + ' 草稿');
    return view_(null, { version: next });
  });
}

function admin_saveDraft(questions, note) {
  return withLock_(function () {
    saveDraft_(questions, note);
    return view_(null);
  });
}

function admin_publishDraft(questions, note) {
  return withLock_(function () {
    var draft = saveDraft_(questions, note);
    if (!draft.change_note) throw new Error('請先填「這一版改了什麼」');
    var t = table_('templates');
    var stamp = now_();
    t.rows.filter(function (r) { return r.status === 'published'; }).forEach(function (r) {
      updateRow_(t, r, { status: 'archived' });
    });
    updateRow_(t, draft, { status: 'published', published_at: stamp });
    audit_('publish_template', '', 'v' + draft.version + '：' + draft.change_note);
    return view_(null, { version: Number(draft.version) });
  });
}

function admin_deleteDraft() {
  return withLock_(function () {
    var t = table_('templates');
    var draft = t.rows.filter(function (r) { return r.status === 'draft'; })[0];
    if (!draft) throw new Error('目前沒有草稿');
    rewriteRows_(t, t.rows.filter(function (r) { return r !== draft; }));
    audit_('delete_template_draft', '', 'v' + draft.version);
    return view_(null);
  });
}

function admin_compare(fromVersion, toVersion) {
  var rows = table_('templates').rows;
  function get(v) {
    var r = rows.filter(function (x) { return String(x.version) === String(v); })[0];
    if (!r) throw new Error('找不到 v' + v);
    return parseJson_(r.questions_json, []);
  }
  var out = compareTemplates_(get(fromVersion), get(toVersion));
  out.from = Number(fromVersion);
  out.to = Number(toVersion);
  return out;
}

/** 課程還沒有人填答時，可以改用其他已發布過的版本；收到第一筆回覆後鎖定 */
function admin_setTemplateVersion(courseId, version) {
  return withLock_(function () {
    var t = table_('courses');
    var row = rowById_(t, courseId);
    var counts = courseCounts_()[courseId] || { responses: 0 };
    if (counts.responses > 0) throw new Error('這堂課已經有人填答，問卷版本已鎖定');
    var tpl = table_('templates').rows.filter(function (r) { return String(r.version) === String(version); })[0];
    if (!tpl) throw new Error('找不到 v' + version);
    if (tpl.status === 'draft') throw new Error('草稿還不能給課程使用，請先發布');
    updateRow_(t, row, { template_version: String(tpl.version), updated_at: now_() });
    audit_('set_template_version', courseId, 'v' + tpl.version);
    return view_(courseId);
  });
}

// ---------- 內部 ----------

function saveDraft_(questions, note) {
  var t = table_('templates');
  var draft = t.rows.filter(function (r) { return r.status === 'draft'; })[0];
  if (!draft) throw new Error('目前沒有草稿，請先「複製成草稿」');
  var clean = cleanQuestions_(questions, t.rows);
  updateRow_(t, draft, { questions_json: JSON.stringify(clean), change_note: cleanText_(note, TPL_LIMITS.NOTE_LEN) });
  return draft;
}

function cleanQuestions_(list, rows, minN) {
  if (!Array.isArray(list)) throw new Error('題目格式不正確');
  if (list.length < TPL_LIMITS.QUESTIONS_MIN || list.length > TPL_LIMITS.QUESTIONS_MAX) {
    throw new Error('每一版要有 ' + TPL_LIMITS.QUESTIONS_MIN + '～' + TPL_LIMITS.QUESTIONS_MAX + ' 題');
  }
  // 所有版本出現過的 id 與它的題型；新題目從最大號碼往下編
  var known = {};
  var maxN = minN || 0;
  rows.forEach(function (r) {
    parseJson_(r.questions_json, []).forEach(function (q) {
      if (!known[q.id]) known[q.id] = q.type;
      var n = Number(String(q.id).replace(/^q/, ''));
      if (n > maxN) maxN = n;
    });
  });
  var seen = {};
  return list.map(function (q, i) {
    var no = '第 ' + (i + 1) + ' 題';
    q = q || {};
    var type = String(q.type || '');
    if (Q_TYPES.indexOf(type) < 0) throw new Error(no + '的題型不正確');
    var label = cleanText_(q.label, TPL_LIMITS.LABEL_LEN);
    if (!label) throw new Error(no + '還沒寫題目');
    var id = String(q.id || '');
    if (id) {
      if (!known[id]) throw new Error(no + '的編號不正確，請重新整理後再試');
      if (known[id] !== type) throw new Error(no + '是既有題目，不能改題型；要換題型請刪除後新增一題');
    } else {
      maxN++;
      id = 'q' + maxN;
    }
    if (seen[id]) throw new Error(no + '和其他題目重複了');
    seen[id] = true;

    var out = { id: id, type: type, label: label, required: q.required === true };
    var opts = Array.isArray(q.options) ? q.options : [];
    if (type === 'single' || type === 'multi' || type === 'rank') {
      var clean = opts.map(function (o) { return cleanText_(o, TPL_LIMITS.OPTION_LEN); }).filter(Boolean);
      var most = type === 'rank' ? TPL_LIMITS.RANK_MAX : TPL_LIMITS.OPTIONS_MAX;
      if (clean.length < TPL_LIMITS.OPTIONS_MIN || clean.length > most) {
        throw new Error(no + '的選項要有 ' + TPL_LIMITS.OPTIONS_MIN + '～' + most + ' 個');
      }
      clean.forEach(function (o, j) { if (clean.indexOf(o) !== j) throw new Error(no + '有重複的選項：' + o); });
      out.options = clean;
    } else if (type === 'rating') {
      out.options = [cleanText_(opts[0], TPL_LIMITS.END_LEN), cleanText_(opts[1], TPL_LIMITS.END_LEN)];
    } else if (type === 'text') {
      var max = Number(q.maxLength) || 500;
      out.maxLength = Math.max(1, Math.min(500, Math.round(max)));
    }
    return out;
  });
}

/** 列出從 a 到 b 新增、刪除、修改的題目；題目靠 id 對應 */
function compareTemplates_(a, b) {
  var A = {}, B = {};
  a.forEach(function (q) { A[q.id] = q; });
  b.forEach(function (q) { B[q.id] = q; });
  var added = b.filter(function (q) { return !A[q.id]; }).map(brief_);
  var removed = a.filter(function (q) { return !B[q.id]; }).map(brief_);
  var changed = [];
  b.forEach(function (q) {
    var o = A[q.id];
    if (!o) return;
    var diffs = [];
    if (o.label !== q.label) diffs.push('題目文字：「' + o.label + '」→「' + q.label + '」');
    if (!!o.required !== !!q.required) diffs.push(q.required ? '改成必填' : '改成選填');
    if (JSON.stringify(o.options || []) !== JSON.stringify(q.options || [])) {
      diffs.push((q.type === 'rating' ? '兩端說明：' : '選項：') + (o.options || []).join('・') + ' → ' + (q.options || []).join('・'));
    }
    if (q.type === 'text' && (o.maxLength || 500) !== (q.maxLength || 500)) {
      diffs.push('字數上限：' + (o.maxLength || 500) + ' → ' + (q.maxLength || 500));
    }
    if (diffs.length) changed.push({ id: q.id, type: q.type, label: q.label, diffs: diffs });
  });
  var orderA = a.map(function (q) { return q.id; }).filter(function (id) { return B[id]; });
  var orderB = b.map(function (q) { return q.id; }).filter(function (id) { return A[id]; });
  return { added: added, removed: removed, changed: changed, reordered: orderA.join(',') !== orderB.join(',') };
}

function brief_(q) {
  return { id: q.id, type: q.type, label: q.label };
}
