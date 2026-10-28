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
