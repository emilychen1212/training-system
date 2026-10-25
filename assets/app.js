/* 學員端共用工具：呼叫公開 API、建立元素（只用 textContent）、產生 QR Code。 */
(function () {
  'use strict';
  var TS = window.TS = {};
  var cfg = window.APP_CONFIG || {};

  /** POST + text/plain：瀏覽器不會先送跨網域預檢，Apps Script 才收得到 */
  TS.api = function (action, payload) {
    if (!cfg.API_URL) return Promise.resolve({ ok: false, error: 'NOT_CONFIGURED' });
    var body = Object.assign({ action: action }, payload || {});
    return fetch(cfg.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    }).then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'NETWORK' }; });
  };

  TS.adminUrl = cfg.ADMIN_URL || '';

  TS.code = function () {
    return (new URLSearchParams(location.search).get('c') || '').trim();
  };

  TS.h = function (tag, props) {
    var el = document.createElement(tag);
    if (props) setProps(el, props);
    add(el, [].slice.call(arguments, 2));
    return el;
  };

  /** 換掉元素內容；null 與 false 會被略過，不會變成文字 */
  TS.fill = function (el) {
    el.replaceChildren();
    add(el, [].slice.call(arguments, 1));
  };

  function setProps(el, props) {
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
  }

  function add(el, kids) {
    kids.forEach(function (k) {
      if (k === null || k === undefined || k === false) return;
      if (Array.isArray(k)) add(el, k);
      else el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
    });
  }

  /** 只放「這台手機填過了」這種方便用的資訊；讀不到也不影響功能 */
  TS.store = {
    get: function (key) {
      try { return JSON.parse(localStorage.getItem('ts:' + key)); } catch (e) { return null; }
    },
    set: function (key, value) {
      try { localStorage.setItem('ts:' + key, JSON.stringify(value)); } catch (e) { /* 無痕模式 */ }
    }
  };

  TS.surveyUrl = function (code) {
    return new URL('../s/?c=' + encodeURIComponent(code), location.href).href;
  };

  TS.qrSvg = function (text, color) {
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '問卷 QR Code');
    var d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', color || '#12305C');
    svg.appendChild(path);
    return svg;
  };

  TS.formatDate = function (date) {
    return String(date || '').replace(/-/g, '/');
  };
})();
