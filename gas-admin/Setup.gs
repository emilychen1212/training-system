/**
 * 初始化與自我測試。
 *
 * setupSheets()  一鍵建立五個分頁與欄位，並寫入公版問卷 v1。重複執行不會覆蓋既有資料。
 * runSelfTest()  測試遮罩、公式注入防護、輸入驗證與抽獎不重複，結果印在「執行紀錄」。
 */

var SCHEMA = {
  courses: ['course_id', 'title', 'date', 'start_time', 'org_name', 'org_type', 'location', 'product_tags',
    'attendees', 'status', 'template_version', 'survey_code', 'slide_type', 'slide_url', 'prizes_json',
    'created_at', 'updated_at', 'raffle_count_final', 'winner_count_final', 'raffle_cleared_at'],
  templates: ['version', 'status', 'questions_json', 'change_note', 'published_at'],
  responses: ['response_id', 'course_id', 'template_version', 'submitted_at', 'answers_json'],
  raffle_entries: ['entry_id', 'course_id', 'name', 'email', 'consent_at', 'created_at', 'prize', 'drawn_at', 'email_hash'],
  audit_log: ['time', 'action', 'course_id', 'detail']
};

// rating 題的 options 放 1 分與 5 分兩端的說明文字
var TEMPLATE_V1 = [
  { id: 'q1', type: 'rating', label: '整體而言，您對本次課程的滿意度？', required: true, options: ['非常不滿意', '非常滿意'] },
  { id: 'q2', type: 'rating', label: '本次介紹的資源，對您的學習或工作有幫助嗎？', required: true, options: ['沒有幫助', '非常有幫助'] },
  { id: 'q3', type: 'single', label: '課後您會實際使用這個資源嗎？', required: true, options: ['會', '可能會', '不會'] },
  { id: 'q4', type: 'single', label: '您的身分？', required: true, options: ['學生', '教師', '研究人員', '醫護人員', '圖書館員', '其他'] },
  { id: 'q5', type: 'text', label: '想對講師說的話，或希望下次介紹的主題？', required: false, maxLength: 500 }
];

function setupSheets() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(function (name) {
    var headers = SCHEMA[name];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      // 舊表缺欄位時補在最後面，不動既有資料
      var current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      headers.forEach(function (h) {
        if (current.indexOf(h) < 0) {
          current.push(h);
          sh.getRange(1, current.length).setValue(h);
        }
      });
      headers = current;
    }
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#E6EEF9').setFontColor('#12305C');
    sh.setFrozenRows(1);
  });

  ss.getSheets().forEach(function (sh) {
    if (!SCHEMA[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  var templates = ss.getSheetByName('templates');
  if (templates.getLastRow() < 2) {
    appendRow_(templates, ['1', 'published', JSON.stringify(TEMPLATE_V1), '初始版本', now_()]);
  }
  Logger.log('完成！試算表 ID（貼到公開 API 的指令碼屬性 SPREADSHEET_ID）：' + ss.getId());
}

// ---------- 自我測試 ----------

function runSelfTest() {
  var results = [];
  function check(name, pass, extra) {
    results.push((pass ? '✅ ' : '❌ ') + name + (extra ? '　' + extra : ''));
  }

  // 1. 遮罩
  check('姓名遮罩 三字', maskName_('王小明') === '王○明', maskName_('王小明'));
  check('姓名遮罩 兩字', maskName_('王明') === '王○', maskName_('王明'));
  check('姓名遮罩 四字不洩露字數', maskName_('歐陽娜娜') === '歐○娜', maskName_('歐陽娜娜'));
  check('Email 遮罩', maskEmail_('mingwang@gmail.com') === 'mi***@gmail.com', maskEmail_('mingwang@gmail.com'));
  check('Email 遮罩 短帳號', maskEmail_('a@b.co') === 'a***@b.co', maskEmail_('a@b.co'));

  // 2. 公式注入
  check('公式注入 =', safeCell_('=1+1') === "'=1+1");
  check('公式注入 + - @', safeCell_('+1') === "'+1" && safeCell_('-1') === "'-1" && safeCell_('@a') === "'@a");
  check('一般文字不變', safeCell_('你好=1') === '你好=1');
  check('CSV 也防注入', csvCell_('=HYPERLINK("x")') === '"\'=HYPERLINK(""x"")"');

  // 3. 簡報連結
  var canva = 'https://www.canva.com/design/DAAAAA1111/abcDEF_123-x/view?embed';
  check('Canva 檢視連結', normalizeSlide_('canva', 'https://www.canva.com/design/DAAAAA1111/abcDEF_123-x/view?utm_content=x').slide_url === canva);
  check('Canva 整段嵌入程式碼', normalizeSlide_('canva',
    '<div><iframe loading="lazy" src="https://www.canva.com/design/DAAAAA1111/abcDEF_123-x/view?embed" allowfullscreen></iframe></div>').slide_url === canva);
  check('雲端硬碟 PDF 連結', normalizeSlide_('pdf', 'https://drive.google.com/file/d/1AbC-xyz_9/view?usp=drive_link').slide_url ===
    'https://drive.google.com/file/d/1AbC-xyz_9/preview');
  check('簡報不接受 http', throws_(function () { normalizeSlide_('web', 'http://example.com'); }));
  check('Canva 編輯連結會被擋', throws_(function () { normalizeSlide_('canva', 'https://www.canva.com/design/DAAAAA1111/edit'); }));
  check('清空簡報', normalizeSlide_('pdf', '  ').slide_url === '');

  // 4. 透過真正的公開 API 測試驗證、防重複與抽獎
  var url = PropertiesService.getScriptProperties().getProperty('PUBLIC_API_URL');
  if (!url) {
    check('公開 API 測試', false, '略過：請在指令碼屬性加上 PUBLIC_API_URL 後再執行一次');
  } else {
    runApiTests_(url, check);
  }

  var failed = results.filter(function (r) { return r.indexOf('❌') === 0; }).length;
  Logger.log('\n' + results.join('\n') + '\n\n共 ' + results.length + ' 項，' +
    (failed ? failed + ' 項沒通過' : '全部通過'));
  return { total: results.length, failed: failed, results: results };
}

function runApiTests_(url, check) {
  function call(body) {
    var res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify(body), muteHttpExceptions: true, followRedirects: true
    });
    TABLES_ = {}; // 公開 API 剛寫入試算表，後台手上的資料要重讀
    return JSON.parse(res.getContentText());
  }
  var good = { q1: 5, q2: 4, q3: '會', q4: '學生', q5: '測試留言' };

  var id = admin_saveCourse({
    title: '[自我測試] 請勿使用', date: now_('yyyy-MM-dd'), start_time: '09:00',
    org_name: '測試', org_type: '其他', prizes: [{ name: '測試獎', qty: 2 }]
  }).detail.course.course_id;
  var code = findCourse_(id).survey_code;
  try {
    check('草稿課程不能填答', call({ action: 'submitResponse', survey_code: code, answers: good, elapsed: 10 }).error === 'NOT_OPEN');
    admin_setStatus(id, 'open');

    var survey = call({ action: 'getSurvey', survey_code: code });
    check('取得題目', survey.ok && survey.questions.length === 5);
    check('不存在的代碼', call({ action: 'getSurvey', survey_code: '0000-000000' }).error === 'NOT_FOUND');
    check('必填沒填會被擋', call({ action: 'submitResponse', survey_code: code, answers: { q1: 5 }, elapsed: 10 }).error === 'REQUIRED');
    check('不存在的選項會被擋', call({ action: 'submitResponse', survey_code: code,
      answers: { q1: 5, q2: 4, q3: '也許', q4: '學生' }, elapsed: 10 }).error === 'INVALID');
    check('評分超出 1–5 會被擋', call({ action: 'submitResponse', survey_code: code,
      answers: { q1: 6, q2: 4, q3: '會', q4: '學生' }, elapsed: 10 }).error === 'INVALID');
    check('文字超過 500 字會被擋', call({ action: 'submitResponse', survey_code: code,
      answers: { q1: 5, q2: 4, q3: '會', q4: '學生', q5: new Array(502).join('字') }, elapsed: 10 }).error === 'TOO_LONG');
    check('少於 5 秒會被擋', call({ action: 'submitResponse', survey_code: code, answers: good, elapsed: 2 }).error === 'TOO_FAST');

    var before = countRows_('responses', id);
    var bot = call({ action: 'submitResponse', survey_code: code, answers: good, elapsed: 10, website: 'http://spam' });
    check('隱藏欄位有值：回 ok 但不寫入', bot.ok && countRows_('responses', id) === before);

    var tokens = [];
    for (var i = 0; i < 3; i++) {
      var r = call({ action: 'submitResponse', survey_code: code, answers: good, elapsed: 10 });
      tokens.push(r.raffle_token);
    }
    check('正常填答 3 份', countRows_('responses', id) === before + 3);
    check('抽獎沒勾同意會被擋', call({ action: 'registerRaffle', survey_code: code, name: '測試', email: 'a@test.com',
      consent: false, raffle_token: tokens[0] }).error === 'CONSENT_REQUIRED');
    check('Email 格式錯誤會被擋', call({ action: 'registerRaffle', survey_code: code, name: '測試', email: 'not-mail',
      consent: true, raffle_token: tokens[0] }).error === 'INVALID_EMAIL');
    check('沒有填問卷的憑證會被擋', call({ action: 'registerRaffle', survey_code: code, name: '測試', email: 'z@test.com',
      consent: true, raffle_token: 'x.y.z.w' }).error === 'BAD_TOKEN');
    check('姓名為 =1+1 可以登記', call({ action: 'registerRaffle', survey_code: code, name: '=1+1', email: 'Alpha@Test.com',
      consent: true, raffle_token: tokens[0] }).ok === true);
    check('同一張憑證不能再用', call({ action: 'registerRaffle', survey_code: code, name: '乙', email: 'b@test.com',
      consent: true, raffle_token: tokens[0] }).error === 'TOKEN_USED');
    check('同 Email（大小寫不同）不能重複登記', call({ action: 'registerRaffle', survey_code: code, name: '甲二',
      email: 'alpha@test.com', consent: true, raffle_token: tokens[1] }).error === 'DUPLICATE');
    call({ action: 'registerRaffle', survey_code: code, name: '乙', email: 'b@test.com', consent: true, raffle_token: tokens[1] });
    call({ action: 'registerRaffle', survey_code: code, name: '丙', email: 'c@test.com', consent: true, raffle_token: tokens[2] });

    var entries = table_('raffle_entries');
    var formulaRow = entries.rows.filter(function (r) { return r.course_id === id && r.email === 'alpha@test.com'; })[0];
    var nameCol = entries.head.indexOf('name') + 1;
    var cell = entries.sh.getRange(formulaRow._row, nameCol);
    check('試算表裡 =1+1 是文字不是公式', cell.getFormula() === '' && String(cell.getValue()) === '=1+1',
      '儲存格內容：' + cell.getValue());

    var live = call({ action: 'getLive', survey_code: code });
    var liveText = JSON.stringify(live);
    check('投影統計數字正確', live.response_count === before + 3 && live.entry_count === 3);
    check('投影資料不含 Email 與姓名', liveText.indexOf('@') < 0 && liveText.indexOf('乙') < 0);

    var early;
    try { admin_draw(id, '測試獎'); } catch (err) { early = err.message; }
    check('未結束填答不能抽獎', !!early);

    admin_setStatus(id, 'closed');
    check('結束後不能再填答', call({ action: 'submitResponse', survey_code: code, answers: good, elapsed: 10 }).error === 'CLOSED');
    admin_draw(id, '測試獎');
    admin_draw(id, '測試獎');
    var full;
    try { admin_draw(id, '測試獎'); } catch (err) { full = err.message; }
    check('獎項抽滿後不能再抽', !!full);
    var won = table_('raffle_entries').rows.filter(function (r) { return r.course_id === id && r.prize; });
    var people = won.map(function (r) { return r.entry_id; });
    check('同一人不會中兩次', won.length === 2 && people[0] !== people[1]);
    var again = admin_getRaffle(id).raffle;
    check('重新讀取只顯示已存結果', again.prizes[0].winners.length === 2 && again.remaining === 1);

    admin_clearRaffle(id, '清除');
    check('清除後試算表沒有這堂課的姓名與 Email', countRows_('raffle_entries', id) === 0);
    var after = findCourse_(id);
    check('清除後保留登記人數與得獎人數', after.entry_count === 3 && after.winner_count === 2);
  } finally {
    removeTestCourse_(id);
  }
}

function throws_(fn) {
  try { fn(); } catch (err) { return true; }
  return false;
}

function countRows_(name, courseId) {
  return table_(name).rows.filter(function (r) { return r.course_id === courseId; }).length;
}

function removeTestCourse_(id) {
  ['responses', 'raffle_entries', 'courses'].forEach(function (name) {
    var t = table_(name);
    rewriteRows_(t, t.rows.filter(function (r) { return r.course_id !== id; }));
  });
}
