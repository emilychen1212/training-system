/*
 * 本機測試伺服器：node dev/server.js
 *   http://localhost:8768/s/?c=代碼     學員問卷
 *   http://localhost:8768/live/?c=代碼  課堂投影
 *   http://localhost:8768/admin         講師後台（模擬 google.script.run）
 *   http://localhost:8768/selftest      執行 runSelfTest()
 * 資料只存在記憶體，關掉就消失。SEED=1 會先建立一堂示範課。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { FakeSpreadsheet, makeProject, renderTemplate } = require('./gas-fakes');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8768);
const LATENCY = Number(process.env.LATENCY || 250);

const ss = new FakeSpreadsheet();
const pub = makeProject(ss, [path.join(ROOT, 'gas-public/Code.gs')]);
pub.__props.set('SPREADSHEET_ID', ss.getId());

function callPublic(body) {
  return pub.doPost({ postData: { contents: body } }).getContent();
}
const admin = makeProject(ss, ['Code.gs', 'Setup.gs'].map((f) => path.join(ROOT, 'gas-admin', f)), {
  UrlFetchApp: { fetch: (url, opt) => {
    const text = callPublic(opt.payload);
    return { getContentText: () => text, getResponseCode: () => 200 };
  } }
});
admin.__props.set('SITE_URL', `http://localhost:${PORT}/`);
admin.__props.set('PUBLIC_API_URL', 'http://dev/api');
admin.setupSheets();

if (process.env.SEED) seed();

function seed() {
  const today = admin.now_('yyyy-MM-dd');
  const id = admin.admin_saveCourse({
    title: 'JoVE 實驗影片資料庫講習', date: today, start_time: '14:00', org_name: '○○大學 圖書館',
    org_type: '學校', location: '視聽教室 B1', product_tags: ['JoVE'], attendees: 42,
    prizes: [{ name: '全家禮物卡 NT$100', qty: 5 }, { name: 'JoVE 限定帆布袋', qty: 3 }]
  });
  admin.admin_setStatus(id, 'open');
  const code = admin.findCourse_(id).survey_code;
  const people = [['王小明', 'mingwang@gmail.com'], ['陳怡伃', 'emily@ntu.edu.tw'], ['林志安', 'andy@yahoo.com.tw'],
    ['黃美婷', 'tina@gmail.com'], ['李大華', 'dahua@hospital.org'], ['張三', 'zhang3@gmail.com'], ['Amy', 'amy@school.edu']];
  const roles = ['學生', '教師', '研究人員', '醫護人員', '圖書館員'];
  people.forEach((p, i) => {
    const r = JSON.parse(callPublic(JSON.stringify({ action: 'submitResponse', survey_code: code, elapsed: 30,
      answers: { q1: 4 + (i % 2), q2: 3 + (i % 3), q3: ['會', '可能會', '會'][i % 3], q4: roles[i % 5], q5: i % 2 ? '' : '實驗前先看影片很有幫助' } })));
    callPublic(JSON.stringify({ action: 'registerRaffle', survey_code: code, name: p[0], email: p[1], consent: true, raffle_token: r.raffle_token }));
  });
  admin.admin_saveCourse({ title: 'VisualDx 臨床影像診斷工具', date: today.slice(0, 8) + '28', start_time: '10:00',
    org_name: '○○護理專科學校', org_type: '學校', product_tags: ['VisualDx'], prizes: [] });
  console.log('示範課程代碼：' + code);
  console.log(`  學員問卷 http://localhost:${PORT}/s/?c=${code}`);
  console.log(`  課堂投影 http://localhost:${PORT}/live/?c=${code}`);
}

const SHIM = `<script>
(function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, fn) {
      if (fn === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (fn === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () {
        var args = [].slice.call(arguments);
        fetch('/admin-rpc', { method: 'POST', body: JSON.stringify({ fn: fn, args: args }) })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (j.ok) { ok && ok(j.result); } else { fail && fail(new Error(j.error)); } });
      };
    } });
  }
  window.google = { script: { run: runner() } };
})();
</script>`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

function send(res, status, type, body) {
  setTimeout(() => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  }, LATENCY);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/config.js') {
      return send(res, 200, TYPES['.js'], `window.APP_CONFIG = { API_URL: '/api', ADMIN_URL: '/admin' };`);
    }
    if (url.pathname === '/api' && req.method === 'POST') {
      return send(res, 200, TYPES['.json'], callPublic(await readBody(req)));
    }
    if (url.pathname === '/admin') {
      const initial = JSON.stringify({ page: url.searchParams.get('page') || '', code: url.searchParams.get('c') || '' });
      return send(res, 200, TYPES['.html'], renderTemplate(path.join(ROOT, 'gas-admin'), 'Index', { initial }, SHIM));
    }
    if (url.pathname === '/admin-rpc' && req.method === 'POST') {
      const { fn, args } = JSON.parse(await readBody(req));
      if (!/^admin_\w+$/.test(fn) || typeof admin[fn] !== 'function') return send(res, 200, TYPES['.json'], JSON.stringify({ ok: false, error: '沒有這個函式' }));
      try {
        const result = admin[fn].apply(null, args);
        return send(res, 200, TYPES['.json'], JSON.stringify({ ok: true, result: result === undefined ? null : result }));
      } catch (err) {
        return send(res, 200, TYPES['.json'], JSON.stringify({ ok: false, error: err.message }));
      }
    }
    if (url.pathname === '/selftest') {
      admin.__log.length = 0;
      const r = admin.runSelfTest();
      return send(res, 200, 'text/plain; charset=utf-8', admin.__log.join('\n') + '\n' + JSON.stringify({ total: r.total, failed: r.failed }));
    }
    if (url.pathname === '/dump') {
      const out = {};
      ss.getSheets().forEach((s) => { out[s.getName()] = s.getDataRange().getValues(); });
      return send(res, 200, TYPES['.json'], JSON.stringify(out, null, 1));
    }
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) return send(res, 403, 'text/plain', 'forbidden');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return send(res, 404, 'text/plain', 'not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    send(res, 500, 'text/plain', String(err && err.stack));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`講習站本機測試：http://localhost:${PORT}/admin`));
