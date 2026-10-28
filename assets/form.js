/* 學員端表單共用：依題目定義產生作答卡片（課後問卷與學習單都用這一份）。所有文字都走 textContent。 */
(function () {
  'use strict';
  var h = TS.h;

  /**
   * 回傳 { cards, answers, filled(q), missing(), clean() }。
   * onChange 在每次作答變動時呼叫（用來更新進度條、清掉錯誤訊息）。
   * placeholder 是文字題的提示文字。
   */
  TS.questionForm = function (questions, onChange, placeholder) {
    var answers = {};

    function touched(q) {
      var card = document.getElementById('q-' + q.id);
      if (card) card.classList.remove('missing');
      if (onChange) onChange();
    }

    function pick(q, value, group) {
      answers[q.id] = value;
      [].forEach.call(group.children, function (b) {
        var v = q.type === 'rating' ? Number(b.textContent) : b.textContent;
        b.setAttribute('aria-checked', String(v === value));
      });
      touched(q);
    }

    function render(q, i) {
      var labelId = 'label-' + q.id;
      var card = h('div', { class: 'q', id: 'q-' + q.id },
        h('div', { class: 'q-tag' + (q.required ? ' req' : ''), text: 'Q' + (i + 1) + '・' + (q.required ? '必填' : '選填') }),
        h('div', { class: 'q-label', id: labelId, text: q.label }));

      if (q.type === 'rating') {
        var group = h('div', { class: 'rating', role: 'radiogroup', 'aria-labelledby': labelId });
        [1, 2, 3, 4, 5].forEach(function (n) {
          group.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': n + ' 分', text: String(n),
            onclick: function () { pick(q, n, group); } }));
        });
        card.appendChild(group);
        var ends = q.options || [];
        if (ends[0] || ends[1]) card.appendChild(h('div', { class: 'ends' }, h('span', { text: '1 ' + (ends[0] || '') }), h('span', { text: '5 ' + (ends[1] || '') })));
      } else if (q.type === 'single' || q.type === 'yesno') {
        var opts = q.type === 'yesno' ? ['是', '否'] : q.options;
        var list = h('div', { class: 'choices' + (q.type === 'yesno' ? ' two' : ''), role: 'radiogroup', 'aria-labelledby': labelId });
        opts.forEach(function (o) {
          list.appendChild(h('button', { type: 'button', class: 'choice', role: 'radio', 'aria-checked': 'false', text: o,
            onclick: function () { pick(q, o, list); } }));
        });
        card.appendChild(list);
      } else if (q.type === 'multi') {
        var boxes = h('div', { class: 'choices', role: 'group', 'aria-labelledby': labelId });
        q.options.forEach(function (o) {
          var btn = h('button', { type: 'button', class: 'choice box', role: 'checkbox', 'aria-checked': 'false', text: o });
          btn.addEventListener('click', function () {
            var cur = answers[q.id] || [];
            var on = cur.indexOf(o) >= 0;
            answers[q.id] = on ? cur.filter(function (x) { return x !== o; }) : cur.concat(o);
            btn.setAttribute('aria-checked', String(!on));
            touched(q);
          });
          boxes.appendChild(btn);
        });
        card.appendChild(h('div', { class: 'fine', style: 'margin:-8px 0 10px', text: '可複選' }));
        card.appendChild(boxes);
      } else if (q.type === 'rank') {
        card.appendChild(h('div', { class: 'fine', style: 'margin:-8px 0 10px', text: '按住左邊的 ⠿ 拖曳，或按箭頭調整順序，第 1 名放最上面' }));
        card.appendChild(rankList(q, labelId));
      } else if (q.type === 'text') {
        var max = Math.min(q.maxLength || 500, 500);
        var count = h('div', { class: 'count', text: '0 / ' + max });
        var ta = h('textarea', { rows: '3', maxlength: String(max), placeholder: placeholder || '留下您的想法', 'aria-labelledby': labelId });
        ta.addEventListener('input', function () {
          answers[q.id] = ta.value;
          count.textContent = Array.from(ta.value).length + ' / ' + max;
          touched(q);
        });
        card.appendChild(ta);
        card.appendChild(count);
      }
      return card;
    }

    /**
     * 排序題：起始順序每人打亂；拖曳用 pointer 事件（手機手指也能拖），另有 ↑↓ 按鈕與鍵盤方向鍵。
     * 學員動過順序、或按「這個順序就對了」之後才算作答。
     */
    function rankList(q, labelId) {
      var order = shuffled(q.options);
      var list = h('ol', { class: 'rank', 'aria-labelledby': labelId });
      var live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
      var ok = h('button', { type: 'button', class: 'rank-ok', text: '這個順序就對了', onclick: function () { commit(); } });
      var wrap = h('div', null, list, ok, live);

      function commit() {
        answers[q.id] = order.slice();
        ok.hidden = true;
        wrap.classList.add('done');
        touched(q);
      }

      function move(from, to, focusDir) {
        if (to < 0 || to >= order.length || from === to) return;
        var item = order.splice(from, 1)[0];
        order.splice(to, 0, item);
        draw();
        commit();
        live.textContent = item + ' 移到第 ' + (to + 1) + ' 名';
        if (focusDir) {
          var btn = list.children[to].querySelector(focusDir === 'up' ? '.up' : '.down');
          (btn && !btn.disabled ? btn : list.children[to].querySelector('.grip')).focus();
        }
      }

      function draw() {
        list.replaceChildren.apply(list, order.map(function (o, i) {
          var grip = h('button', { type: 'button', class: 'grip', 'aria-label': '第 ' + (i + 1) + ' 名：' + o + '，按住拖曳或用上下方向鍵移動' },
            h('span', { class: 'dots6', 'aria-hidden': 'true', text: '⠿' }), h('b', { class: 'num', text: String(i + 1) }));
          grip.addEventListener('keydown', function (ev) {
            if (ev.key === 'ArrowUp') { ev.preventDefault(); move(i, i - 1); list.children[Math.max(i - 1, 0)].querySelector('.grip').focus(); }
            if (ev.key === 'ArrowDown') { ev.preventDefault(); move(i, i + 1); list.children[Math.min(i + 1, order.length - 1)].querySelector('.grip').focus(); }
          });
          grip.addEventListener('pointerdown', function (ev) { startDrag(ev, i); });
          return h('li', { class: 'rank-item' }, grip,
            h('span', { class: 'rank-text', text: o }),
            h('button', { type: 'button', class: 'up', 'aria-label': '把「' + o + '」往上移', text: '↑', disabled: i === 0, onclick: function () { move(i, i - 1, 'up'); } }),
            h('button', { type: 'button', class: 'down', 'aria-label': '把「' + o + '」往下移', text: '↓', disabled: i === order.length - 1,
              onclick: function () { move(i, i + 1, 'down'); } }));
        }));
      }

      function startDrag(ev, from) {
        if (ev.button > 0) return;
        ev.preventDefault();
        var items = [].slice.call(list.children);
        var me = items[from];
        var sy = window.scrollY;
        var rects = items.map(function (el) { var r = el.getBoundingClientRect(); return { top: r.top + sy, h: r.height }; });
        var gap = items.length > 1 ? rects[1].top - rects[0].top - rects[0].h : 8;
        var shift = rects[from].h + gap;
        var startY = ev.clientY + sy;
        var lastY = ev.clientY;
        var to = from, raf = 0;
        list.classList.add('dragging');
        me.classList.add('lift');
        try { ev.target.setPointerCapture(ev.pointerId); } catch (e) { /* 舊瀏覽器沒有也沒關係 */ }

        function layout() {
          var dy = lastY + window.scrollY - startY;
          me.style.transform = 'translateY(' + dy + 'px)';
          var center = rects[from].top + dy + rects[from].h / 2;
          to = 0;
          rects.forEach(function (r, i) { if (i !== from && r.top + r.h / 2 < center) to++; });
          items.forEach(function (el, i) {
            if (i === from) return;
            var d = from < i && i <= to ? -shift : to <= i && i < from ? shift : 0;
            el.style.transform = d ? 'translateY(' + d + 'px)' : '';
          });
        }
        // 拖到畫面上下邊緣時自動捲動
        function edge() {
          var zone = 70, v = 0;
          if (lastY < zone) v = -Math.ceil((zone - lastY) / 6);
          else if (lastY > window.innerHeight - zone) v = Math.ceil((lastY - window.innerHeight + zone) / 6);
          if (v) { window.scrollBy(0, v); layout(); }
          raf = requestAnimationFrame(edge);
        }
        function onMove(e) { lastY = e.clientY; layout(); }
        function onEnd() {
          cancelAnimationFrame(raf);
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onEnd);
          document.removeEventListener('pointercancel', onEnd);
          list.classList.remove('dragging');
          items.forEach(function (el) { el.style.transform = ''; el.classList.remove('lift'); });
          if (to !== from) move(from, to);
          else draw();
          var g = list.children[to] && list.children[to].querySelector('.grip');
          if (g) g.focus({ preventScroll: true });
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onEnd);
        document.addEventListener('pointercancel', onEnd);
        raf = requestAnimationFrame(edge);
      }

      draw();
      return wrap;
    }

    function filled(q) {
      var v = answers[q.id];
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.trim() !== '';
      return v !== undefined;
    }

    return {
      answers: answers,
      cards: questions.map(render),
      filled: filled,
      missing: function () { return questions.filter(function (q) { return q.required && !filled(q); }); },
      clean: function () {
        var out = {};
        questions.forEach(function (q) {
          if (filled(q)) out[q.id] = typeof answers[q.id] === 'string' ? answers[q.id].trim() : answers[q.id];
        });
        return out;
      }
    };
  };

  /** 打亂順序；選項兩個以上時保證和原本順序不同 */
  function shuffled(list) {
    var a = list.slice();
    for (var tries = 0; tries < 5; tries++) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      if (a.join('\n') !== list.join('\n')) break;
    }
    return a;
  }

  /** 送出按鈕：按下後下沉，送出中顯示三顆跳動小圓點 */
  TS.setBusy = function (btn, busy, label) {
    btn.disabled = busy;
    btn.classList.toggle('busy', busy);
    if (busy) btn.replaceChildren(h('span', { class: 'dots', 'aria-label': '送出中' }, h('i'), h('i'), h('i')));
    else btn.textContent = label;
  };

  /** 完成頁的勾勾（筆畫動畫）與彈一下的橘點 */
  TS.checkMark = function () {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 84 84');
    svg.setAttribute('aria-hidden', 'true');
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '42');
    c.setAttribute('cy', '42');
    c.setAttribute('r', '40');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M25 43 L37 55 L60 31');
    svg.appendChild(c);
    svg.appendChild(p);
    return h('div', { class: 'check' }, svg, h('i'));
  };
})();
