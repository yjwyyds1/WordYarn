/* ============================================================
   词汇故事集 · 精读与背词
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  var KEY = 'cet4.reader.v2';
  var CN_NUM = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  function cnNum(n) {
    if (n <= 10) return n === 10 ? '拾' : CN_NUM[n];
    if (n < 20) return '拾' + CN_NUM[n - 10];
    if (n < 100) return CN_NUM[Math.floor(n / 10)] + '拾' + (n % 10 ? CN_NUM[n % 10] : '');
    return String(n);
  }

  /* ---------- 状态 ---------- */
  var state = {
    chapter: 'ch01',
    view: 'read',
    theme: 'paper',
    enSize: 17,
    nav: 'open',       // 'open' | 'closed'
    open: {},          // { ch01: { p1:true, p2:false } }
    status: {},        // { ch01: { abandon:'new' } }
    cardAt: {},        // { ch01: 3 } 闪卡位置
    filter: 'all',
    sort: 'alpha',
    query: ''
  };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    Object.keys(saved).forEach(function (k) { state[k] = saved[k]; });
  } catch (e) { /* 忽略损坏的本地数据 */ }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    }, 250);
  }

  /* ---------- 章节数据 ---------- */
  var loaded = {};
  var manifest = window.CHAPTER_MANIFEST || [];
  var current = null, study, chapterVersion = 0;
  var chapterRequests = new Map();
  var readingObserver;
  var flatIdx = {};   // 当前章节的句子扁平索引

  function loadChapter(id) {
    if (loaded[id]) return Promise.resolve(loaded[id]);
    if (chapterRequests.has(id)) return chapterRequests.get(id);
    var request = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'data/' + id + '.js';
      s.onload = function () {
        var arr = window.CHAPTER_DATA || [];
        var d = arr.find(function (entry) { return entry.id === id; });
        if (!d) { reject(new Error('empty')); return; }
        loaded[id] = d;
        resolve(d);
      };
      s.onerror = function () { reject(new Error('load failed: ' + id)); };
      document.head.appendChild(s);
    }).finally(function () { chapterRequests.delete(id); });
    chapterRequests.set(id, request);
    return request;
  }

  function buildIndex(ch) {
    var list = [];
    ch.paragraphs.forEach(function (p, pi) {
      p.sentences.forEach(function (s, si) {
        s._gi = list.length;
        s._pi = pi; s._si = si;
        list.push(s);
      });
    });
    flatIdx = list;
    return list;
  }

  /* ---------- 渲染：顶栏 / 侧栏 ---------- */
  function renderTop() {
    var m = manifest.filter(function (x) { return x.id === state.chapter; })[0];
    if (!m) return;
    var sc = $('#sealChar');
    var label = cnNum(m.no);
    sc.textContent = label;
    sc.style.fontSize = label.length > 1 ? '15px' : '20px';
    $('#seal').setAttribute('title', '第 ' + m.no + ' 章 · ' + m.titleCn);
    $('#nowTitle').textContent = m.title;
    $('#nowSub').textContent = m.titleCn + (m.theme ? ' · ' + m.theme : '');
  }

  function renderSidebar() {
    var host = $('#chList');
    var groups = { 1: '初到校园', 8: '校园与远行', 14: '实习与创业', 17: '校报与社会', 22: '节日与博物馆', 25: '成长与毕业' };
    host.innerHTML = manifest.map(function (m) {
      var heading = groups[m.no] ? '<li class="chapter-group">' + groups[m.no] + '</li>' : '';
      var st = state.status[m.id] || {};
      var known = 0, fuzzy = 0, neu = 0;
      Object.keys(st).forEach(function (k) {
        if (st[k] === 'known') known++; else if (st[k] === 'fuzzy') fuzzy++; else neu++;
      });
      var total = known + fuzzy + neu;
      var dots = '';
      if (total) {
        dots = '<span class="dots">' +
          (known ? '<i class="d-known"></i>' : '') +
          (fuzzy ? '<i class="d-fuzzy"></i>' : '') +
          (neu ? '<i class="d-new"></i>' : '') + '</span>';
      }
      return heading + '<li><button class="ch-item' + (m.id === state.chapter ? ' is-active' : '') + '" data-ch="' + m.id + '">' +
        '<span class="ch-no">' + (m.no < 10 ? '0' + m.no : m.no) + '</span>' +
        '<span class="ch-t"><b>' + esc(m.title) + '</b><i>' + esc(m.titleCn) + '</i></span>' +
        '<span class="ch-meta">' + (m.translated ? '' : '<span class="tag todo">待译</span>') + dots + '</span>' +
        '</button></li>';
    }).join('');
    $('#sideCount').textContent = manifest.length + ' 篇';
    updateSideScroll();
    revealActiveChapter();
  }

  /* ---------- 侧栏：开合 / 滚动 ---------- */
  var drawerOpen = false;
  var compactNav = matchMedia('(max-width: 900px)');
  function applyNav() {
    var closed = isNarrow() ? !drawerOpen : state.nav === 'closed';
    document.body.classList.toggle('nav-closed', closed);
    document.body.classList.toggle('nav-open', !closed);
    var b = $('#btnNav');
    b.classList.toggle('is-on', !closed);
    b.setAttribute('aria-label', (closed ? '展开' : '收起') + '目录');
    b.setAttribute('aria-expanded', closed ? 'false' : 'true');
  }
  function toggleNav(force) {
    if (isNarrow()) {
      drawerOpen = force ?? !drawerOpen;
      applyNav();
      return;
    }
    var want = force !== undefined ? force : (state.nav === 'closed');
    state.nav = want ? 'open' : 'closed';
    applyNav(); save();
  }
  function isNarrow() { return compactNav.matches; }

  function updateSideScroll() {
    var list = $('#chList');
    var rail = $('#sideRail');
    var wrap = list && list.parentElement;
    if (!list || !rail || !wrap) return;
    var max = list.scrollHeight - list.clientHeight;
    var p = max > 4 ? list.scrollTop / max : 0;
    rail.style.height = (Math.min(1, Math.max(0, p)) * 100) + '%';
    wrap.classList.toggle('at-top', list.scrollTop > 3);
    wrap.classList.toggle('at-bottom', max > 3 && list.scrollTop < max - 3);
  }
  function revealActiveChapter() {
    var el = $('#chList .ch-item.is-active');
    if (!el) return;
    var list = $('#chList');
    var er = el.getBoundingClientRect(), lr = list.getBoundingClientRect();
    if (er.top < lr.top + 4 || er.bottom > lr.bottom - 4) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /* ---------- 渲染：精读 ---------- */
  function markText(en, words) {
    if (!words || !words.length) return esc(en);
    var html = '', last = 0;
    words.forEach(function (w) {
      if (w.at < last) return;
      html += esc(en.slice(last, w.at));
      html += '<span class="w" data-w="' + esc(w.w) + '" tabindex="0">' + esc(en.substr(w.at, w.len)) + '</span>';
      last = w.at + w.len;
    });
    html += esc(en.slice(last));
    return html;
  }

  function renderRead(ch) {
    var head =
      '<div id="vocabReturn" class="origin-return" hidden><button class="btn" data-vocab-return>返回词表</button><span>正在查看原句</span></div>' +
      '<header class="ch-head">' +
        '<div class="kicker">Chapter ' + (ch.no < 10 ? '0' + ch.no : ch.no) + '</div>' +
        '<h1 class="ch-name">' + esc(ch.title) + '<span>' + esc(ch.titleCn) + '</span></h1>' +
        (ch.theme ? '<p class="ch-theme">' + esc(ch.theme) + '</p>' : '') +
        '<details class="chapter-details"><summary>章节详情</summary><dl class="stats">' +
          '<div><dt>段落</dt><dd>' + ch.stats.paragraphs + '</dd></div>' +
          '<div><dt>句子</dt><dd>' + ch.stats.sentences + '</dd></div>' +
          '<div><dt>目标词</dt><dd>' + ch.stats.words + '<em>个</em></dd></div>' +
          '<div><dt>词条</dt><dd>' + ch.stats.entries + '<em>条</em></dd></div>' +
        '</dl>' +
        (ch.tips && ch.tips.length
          ? '<div class="tip"><span class="tip-label">阅读建议</span><p>' + ch.tips.map(esc).join('　') + '</p></div>'
          : '') + '</details>' +
        (ch.translated ? '' :
          '<div class="notice"><b>待译</b><span>本章逐句译文与词汇例句尚未补充，目前只显示英文正文。译文文件放在 <code>content/chNN.sentences.json</code> 与 <code>content/chNN.vocab.json</code>，补完后运行 <code>node tools/build_site_data.mjs</code> 即可自动生成。</span></div>') +
        '<div class="read-tools">' +
          '<button class="btn" data-all="open">展开全部译文</button>' +
          '<button class="btn" data-all="close">收起全部译文</button>' +
          '<span class="hint">点句中 <span class="w-sample">目标词</span> 查释义与例句</span>' +
        '</div>' +
      '</header>';

    var openMap = state.open[ch.id] || {};
    var body = ch.paragraphs.map(function (p, pi) {
      var isOpen = openMap[p.id] !== undefined ? openMap[p.id] : true;
      var prose = p.sentences.map(function (s) { return '<span data-gi="' + s._gi + '">' + markText(s.en, s.words) + '</span>'; }).join(' ');
      var rows = p.sentences.map(function (s) {
        return '<div class="srow" data-gi="' + s._gi + '">' +
          '<div class="sen-no">' + (s._gi + 1) +
            '<button class="speak" data-say-sen="' + s._gi + '" title="朗读这一句" aria-label="朗读第 ' + (s._gi + 1) + ' 句">♪</button>' +
          '</div>' +
          '<div class="sen"><span class="sen-text">' + markText(s.en, s.words) + '</span></div>' +
          '<div class="cn">' + (s.cn ? esc(s.cn) : '<em>译文待补</em>') + '</div>' +
        '</div>';
      }).join('');
      return '<section class="para' + (ch.translated ? '' : ' no-cn') + '" data-para="' + p.id + '" data-open="' + (isOpen ? 'true' : 'false') + '">' +
        '<div class="para-bar">' +
          '<button class="para-toggle" data-toggle aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
            '<span class="para-no">' + cnNum(pi + 1) + '</span>' +
            '<span class="para-meta">第 ' + (pi + 1) + ' 段 · ' + p.sentences.length + ' 句</span>' +
          '</button>' +
          '<button class="speak always" data-say-para="' + p.id + '" title="朗读本段" aria-label="朗读第 ' + (pi + 1) + ' 段">播放本段</button>' +
          '<span class="para-state">' + (isOpen ? '逐句对照' : '连续阅读') + '</span>' +
          '<span class="chev" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="para-playback" hidden><progress aria-label="本段朗读进度"></progress><span></span></div>' +
        '<div class="para-prose">' + prose + '</div>' +
        '<div class="para-rows">' + rows + '</div>' +
        '<button class="btn para-practice" data-study-practice="' + p.id + '">练本段原句</button>' +
      '</section>';
    }).join('');

    $('#view-read').innerHTML = head + body;
  }

  /* ---------- 渲染：词表 ---------- */
  function statusOf(lemma) {
    var st = state.status[state.chapter] || {};
    return st[lemma] || 'new';
  }
  function setStatus(lemma, s, review) {
    study.rate(state.chapter, lemma, s, review);
    if (!state.status[state.chapter]) state.status[state.chapter] = {};
    state.status[state.chapter][lemma] = s;
    save(); renderSidebar();
  }

  /** 原文例句块。多词性的词若本篇没有该词性的用法，明说而不是硬凑。 */
  function speakLink(text, label, kind) {
    return '<button class="link sentence-speak" data-speak-kind="' + kind + '" data-speak="' + esc(text) + '">' + label + '</button>';
  }

  function originBlock(v, withJump) {
    var o = v.origin != null ? flatIdx[v.origin] : null;
    if (o) {
      return '<div class="blk"><div class="blk-h">原文' +
        speakLink(o.en, '朗读原句', 'origin') + (withJump ? '<button class="link" data-jump="' + v.origin + '">定位原句 →</button>' : '') + '</div>' +
        '<p class="blk-en">' + esc(o.en) + '</p>' +
        (o.cn ? '<p class="blk-cn">' + esc(o.cn) + '</p>' : '') + '</div>';
    }
    if (v.sameWord) {
      return '<div class="blk"><div class="blk-h">原文</div>' +
        '<p class="blk-note">本篇正文只出现了「' + esc(v.lemma) + '」的其他词性用法，' +
        esc(v.pos) + ' 这一义项可参考下方造句。</p></div>';
    }
    return '';
  }

  function renderVocab(ch) {
    var q = state.query.trim().toLowerCase();
    var rows = ch.vocab.filter(function (v) {
      if (q && v.lemma.indexOf(q) < 0 && v.def.toLowerCase().indexOf(q) < 0) return false;
      if (state.filter !== 'all' && statusOf(v.lemma) !== state.filter) return false;
      return true;
    });
    if (state.sort === 'alpha') {
      rows.sort(function (a, b) { return a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0; });
    } else {
      rows.sort(function (a, b) { return (a.origin == null ? 999 : a.origin) - (b.origin == null ? 999 : b.origin); });
    }

    var counts = { known: 0, fuzzy: 0, new: 0 };
    var lemmas = Object.create(null);
    ch.vocab.forEach(function (v) {
      if (lemmas[v.lemma]) return;
      lemmas[v.lemma] = 1;
      counts[statusOf(v.lemma)]++;
    });
    var total = Object.keys(lemmas).length;
    var pct = total ? Math.round((counts.known / total) * 100) : 0;

    var head =
      '<header class="ch-head" style="margin-bottom:18px">' +
        '<div class="kicker">Chapter ' + (ch.no < 10 ? '0' + ch.no : ch.no) + ' · 目标词表</div>' +
        '<h1 class="ch-name">' + esc(ch.titleCn) + '<span>' + total + ' 个目标词 / ' + ch.vocab.length + ' 条词条</span></h1>' +
      '</header>' +
      '<div class="v-head">' +
        '<div class="search"><input id="vocabSearch" type="search" placeholder="搜索单词或释义" value="' + esc(state.query) + '"></div>' +
        '<div class="seg" id="vFilter">' +
          ['all:全部', 'new:生疏', 'fuzzy:模糊', 'known:掌握'].map(function (x) {
            var p = x.split(':');
            return '<button data-f="' + p[0] + '"' + (state.filter === p[0] ? ' class="is-active"' : '') + '>' + p[1] + '</button>';
          }).join('') +
        '</div>' +
        '<div class="seg" id="vSort">' +
          '<button data-s="alpha"' + (state.sort === 'alpha' ? ' class="is-active"' : '') + '>字母序</button>' +
          '<button data-s="order"' + (state.sort === 'order' ? ' class="is-active"' : '') + '>出现顺序</button>' +
        '</div>' +
        '<div class="v-progress"><span>已掌握 ' + counts.known + ' / ' + total + '</span>' +
          '<span class="bar"><i style="width:' + pct + '%"></i></span></div>' +
      '</div>';

    if (!rows.length) {
      $('#view-vocab').innerHTML = head + '<div class="empty">没有符合条件的词条</div>';
      return;
    }

    var groups = new Map();
    rows.forEach(function (v) { if (!groups.has(v.lemma)) groups.set(v.lemma, []); groups.get(v.lemma).push(v); });
    var cards = Array.from(groups.values()).map(function (senses) {
      var v = senses[0];
      var st = statusOf(v.lemma);
      return '<article class="card" data-w="' + esc(v.lemma) + '" data-status="' + st + '">' +
        '<div class="card-top">' +
          '<span class="card-w">' + esc(v.w) + '</span>' +
          '<span class="card-ipa">' + esc(v.ipa || '') + '</span>' +
        '</div>' +
        senses.map(function (sense) {
          return '<div class="vocab-sense"><p class="card-def"><i>' + esc(sense.pos) + '</i> ' + esc(sense.def) + '</p>' +
            originBlock(sense, true) +
            (sense.ex ? '<div class="blk"><div class="blk-h">造句' + speakLink(sense.ex.en, '朗读造句', 'example') + '</div>' +
              '<p class="blk-en">' + esc(sense.ex.en) + '</p><p class="blk-cn">' + esc(sense.ex.cn) + '</p>' +
              (sense.ex.note ? '<p class="blk-note">' + esc(sense.ex.note) + '</p>' : '') + '</div>' : '') + '</div>';
        }).join('') +
        '<div class="card-foot">' +
          '<div class="rates">' +
            ['new:生疏', 'fuzzy:模糊', 'known:掌握'].map(function (x) {
              var p = x.split(':');
              return '<button data-rate="' + p[0] + '"' + (st === p[0] ? ' class="on"' : '') + '>' + p[1] + '</button>';
            }).join('') +
          '</div>' +
          '<button class="card-speak" data-speak="' + esc(v.w) + '" title="朗读">&#9835;</button>' +
        '</div>' +
      '</article>';
    }).join('');

    $('#view-vocab').innerHTML = head + '<div class="cards">' + cards + '</div>';
  }

  /* ---------- 渲染：闪卡 ---------- */
  var cardQueue = [], cardAt = 0, cardFlipped = false, cardChapter, cardTotal = 0, lastCardOrder = [];
  var vocabReturn = null;

  function restoreCardPos(ch, all) {
    var seen = new Set();
    var queue = ch.vocab.filter(function (v) {
      if (!v.lemma || seen.has(v.lemma) || (!all && statusOf(v.lemma) === 'known')) return false;
      seen.add(v.lemma);
      return true;
    });
    for (var i = queue.length - 1; i > 0; --i) {
      var j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    if (queue.length > 1 && queue.every(function (v, i) { return v.lemma === lastCardOrder[i]; }))
      queue.push(queue.shift());
    lastCardOrder = queue.map(function (v) { return v.lemma; });
    cardChapter = ch.id;
    cardQueue = queue; cardAt = 0; cardTotal = queue.length; cardFlipped = false;
  }

  function playCard() {
    var v = cardQueue[cardAt];
    if (v && state.cardAudio !== false) speakItems([{text:v.lemma}, {text:v.ex?.en || ''}]);
    else stopSpeech();
  }

  function renderCards(ch) {
    if (cardChapter !== ch.id) restoreCardPos(ch, false);
    var v = cardQueue[cardAt];
    var wrap = $('#view-cards');
    if (!v) {
      var remaining = ch.vocab.some(v => statusOf(v.lemma) !== 'known');
      wrap.innerHTML = '<div class="empty"><p>' + (remaining ? '本轮闪卡已经完成。' : '本章词汇已全部标为掌握。') + '</p>' +
        (remaining ? '<button class="btn primary-study" data-retry-cards>再练未掌握词</button> ' : '') +
        '<button class="btn" data-restart>全部重来</button></div>';
      return;
    }

    var o = v.origin != null ? flatIdx[v.origin] : null;
    var st = statusOf(v.lemma);
    var occ = v.occurrences || 0;

    wrap.innerHTML =
      '<header class="ch-head" style="margin-bottom:16px">' +
        '<div class="kicker">闪卡自测</div>' +
        '<h1 class="ch-name">遮住释义，先自己回忆<span>再翻面核对</span></h1>' +
      '</header>' +
      '<div class="fc-top">' +
        '<div class="fc-nav">' +
          '<button class="fc-navbtn" data-nav="-1" aria-label="上一张" title="上一张（←）">‹</button>' +
          '<span class="fc-idx">已练 ' + (cardTotal - cardQueue.length) + ' / ' + cardTotal + ' · 待练 ' + cardQueue.length + '</span>' +
          '<button class="fc-navbtn" data-nav="1" aria-label="下一张" title="下一张（→）">›</button>' +
        '</div>' +
        '<span class="fc-idx">' + esc(ch.titleCn) + ' · ' +
          '<button class="fc-restart" data-card-audio aria-pressed="' + (state.cardAudio !== false) + '">' + (state.cardAudio !== false ? '自动朗读开' : '自动朗读关') + '</button> · ' +
          '<button class="fc-restart" data-restart title="打乱顺序，包含已掌握词，不清空历史">全部重来</button></span>' +
      '</div>' +
      '<div class="fc-stage"><div class="fc" id="fcCard" tabindex="0" aria-label="闪卡，按空格翻面">' +
        '<div class="fc-face fc-fw">' +
          '<div class="fc-word">' + esc(v.w) + '</div>' +
          (v.ipa ? '<div class="fc-ipa">' + esc(v.ipa) + '</div>' : '') +
          '<div class="fc-pos">' + esc(v.pos) + '</div>' +
          (v.ex?.en ? '<p class="fc-example">' + esc(v.ex.en) + '</p>' : '') +
          '<button class="btn" data-card-play>朗读单词和造句</button>' +
          (occ ? '<div class="fc-occ">本篇出现 ' + occ + ' 次</div>' : '') +
          '<div class="fc-flip">点击卡片翻面</div>' +
        '</div>' +
        '<div class="fc-face fc-back">' +
          '<div class="fc-def">' + esc(v.def) + '</div>' +
          (o ? '<div class="blk"><div class="blk-h">原文</div><p class="blk-en">' + esc(o.en) + '</p>' +
               (o.cn ? '<p class="blk-cn">' + esc(o.cn) + '</p>' : '') + '</div>'
             : (v.sameWord ? '<div class="blk"><div class="blk-h">原文</div><p class="blk-note">本篇正文未出现「' +
                esc(v.lemma) + '」的 ' + esc(v.pos) + ' 义项，可参考下方造句。</p></div>' : '')) +
          (v.ex ? '<div class="blk"><div class="blk-h">造句</div><p class="blk-en">' + esc(v.ex.en) + '</p>' +
               '<p class="blk-cn">' + esc(v.ex.cn) + '</p>' +
               (v.ex.note ? '<p class="blk-note">' + esc(v.ex.note) + '</p>' : '') + '</div>' : '') +
        '</div>' +
      '</div></div>' +
      '<div class="fc-actions">' +
        '<button class="btn" data-rate="new">生疏</button>' +
        '<button class="btn" data-rate="fuzzy">模糊</button>' +
        '<button class="btn" data-rate="known">掌握</button>' +
      '</div>';
  }

  function goCard(delta) {
    if (!cardQueue.length) return;
    cardAt = (cardAt + delta + cardQueue.length) % cardQueue.length;
    cardFlipped = false;
    renderCards(current); playCard();
  }

  function nextCard(rate) {
    var v = cardQueue[cardAt];
    if (!v) return;
    setStatus(v.lemma, rate, true);
    // Each score finishes one card in this round; a new round shuffles again.
    cardQueue.splice(cardAt, 1);
    if (cardAt >= cardQueue.length) cardAt = 0;
    cardFlipped = false;
    renderCards(current); playCard();
  }

  /* ---------- 词条浮层 ---------- */
  function openPop(lemma, anchor) {
    var ch = current;
    var rows = ch.vocab.filter(function (v) { return v.lemma === lemma; });
    if (!rows.length) return;
    var source = anchor.closest('[data-gi]');
    var gi = source ? Number(source.dataset.gi) : null;
    var exact = rows.find(function (row) { return row.origin === gi && gi !== null; });
    var v = exact || rows.find(function (row) { return row.origin != null; }) || rows[0];
    var o = gi !== null ? flatIdx[gi] : flatIdx[v.origin];
    var other = rows.filter(function (row) { return row !== v; });
    var definition = function (row) { return '<span class="pop-pos">' + esc(row.pos) + '</span>' + esc(row.def); };
    var st = statusOf(lemma);

    var html =
      '<button class="pop-close" data-pop-close aria-label="关闭">&times;</button>' +
      '<div class="pop-h">' +
        '<span class="pop-w">' + esc(v.w) + '</span>' +
        '<span class="pop-ipa">' + esc(v.ipa || '') + '</span>' +
        '<button class="pop-speak" data-speak="' + esc(v.w) + '" title="朗读">&#9835;</button>' +
      '</div>' +
      '<div class="pop-def">' +
        '<div class="pop-lab">' + (exact || rows.length === 1 ? '原句释义' : '参考释义') + '</div>' + definition(v) +
        (other.length ? '<details><summary>其他义项</summary>' + other.map(definition).join('<br>') + '</details>' : '') +
      '</div>' +
      (o ? '<div class="pop-row"><div class="pop-lab">原文</div>' +
           '<div class="pop-en">' + esc(o.en) + '</div>' +
           (o.cn ? '<div class="pop-cn">' + esc(o.cn) + '</div>' : '') + '</div>'
         : (v.sameWord ? '<div class="pop-row"><div class="pop-lab">原文</div>' +
           '<div class="pop-note">本篇正文未出现「' + esc(v.lemma) + '」的 ' + esc(v.pos) + ' 义项，可参考下方造句。</div></div>' : '')) +
      (v.ex ? '<div class="pop-row"><div class="pop-lab">造句</div>' +
           '<div class="pop-en">' + esc(v.ex.en) + '</div>' +
           '<div class="pop-cn">' + esc(v.ex.cn) + '</div>' +
           (v.ex.note ? '<div class="pop-note">' + esc(v.ex.note) + '</div>' : '') + '</div>' : '') +
      '<div class="pop-row"><div class="pop-lab">掌握度</div>' +
        '<div class="rates">' +
          ['new:生疏', 'fuzzy:模糊', 'known:掌握'].map(function (x) {
            var p = x.split(':');
            return '<button data-rate="' + p[0] + '"' + (st === p[0] ? ' class="on"' : '') + '>' + p[1] + '</button>';
          }).join('') +
        '</div></div>';

    var pop = $('#pop');
    pop.dataset.lemma = lemma;
    pop.innerHTML = html;
    pop.hidden = false;
    pop.scrollTop = 0;
    speak(v.w, $('.pop-speak', pop));

    pop.style.left = ''; pop.style.top = ''; pop.style.maxHeight = '';
    if (window.innerWidth <= 600) return;
    var r = anchor.getBoundingClientRect();
    var topLimit = $('.topbar').getBoundingClientRect().bottom + 8;
    var bottomLimit = window.innerHeight - 10;
    pop.style.maxHeight = Math.max(100, bottomLimit - topLimit) + 'px';
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var below = r.bottom + 10, above = r.top - ph - 10;
    var left = Math.max(10, Math.min(window.innerWidth - pw - 10, r.left - 12));
    var top = below + ph <= bottomLimit ? below : above >= topLimit ? above : Math.max(topLimit, bottomLimit - ph);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    pop.scrollTop = 0;
  }
  function closePop() { $('#pop').hidden = true; }

  /* ---------- 朗读 ---------- */
  var speech = { token: 0 };
  var synth = window.speechSynthesis;
  var nativeSpeech = action => window.chrome.webview.postMessage('speech:' + action);
  var speechStep = 0, onNativeSpeechDone;
  if (window.wordYarnDesktop) window.wordYarnSpeechResult = function (id, ok, audio) {
    if (id === speechStep && onNativeSpeechDone) onNativeSpeechDone(ok, audio);
  };
  var speechVoices = function () { return (synth?.getVoices() || []).filter(v => /^en/i.test(v.lang)); };
  var voiceVolume = () => state.voiceVolume ?? (window.wordYarnDesktop && !state.voice ? 125 : 100);

  function pickVoice() {
    var voices = speechVoices();
    var preferred = voices.find(v => v.voiceURI === state.voice);
    if (preferred) return preferred;
    var offline = voices.filter(v => v.localService !== false);
    return offline.find(v => /natural|neural|enhanced|premium/i.test(v.name)) ||
      offline.find(v => /^en-US/i.test(v.lang) && /google|aria|jenny|guy/i.test(v.name)) ||
      offline.find(v => /^en-US/i.test(v.lang)) || offline[0] || null;
  }

  function renderVoiceChoices() {
    var sel = $('#voiceChoice'), voices = speechVoices();
    sel.replaceChildren(new Option(voices.length ? '自动选择 · 优先离线' : window.wordYarnDesktop ? 'Windows 本地音色' : '自动选择 · 设备默认', ''));
    for (var voice of voices) sel.append(new Option(voice.name + ' · ' + voice.lang + (voice.localService === false ? '（联网）' : ''), voice.voiceURI));
    sel.value = voices.some(v => v.voiceURI === state.voice) ? state.voice : '';
    $('#voiceRate').value = state.voiceRate || '0.94';
    $('#voiceVolume').max = window.wordYarnDesktop && !sel.value ? 150 : 100;
    $('#voiceBoostHelp').hidden = !window.wordYarnDesktop || Boolean(sel.value);
    $('#voiceVolume').value = voiceVolume();
    $('#voiceVolumeValue').textContent = $('#voiceVolume').value + '%';
    $('#voiceMixer').hidden = !window.wordYarnDesktop;
  }
  synth?.addEventListener('voiceschanged', renderVoiceChoices);
  $('#voiceSettings').addEventListener('click', () => { renderVoiceChoices(); $('#voiceDialog').showModal(); });
  $('#voiceChoice').addEventListener('change', e => { state.voice = e.target.value; save(); });
  $('#voiceRate').addEventListener('change', e => { state.voiceRate = e.target.value; save(); });
  $('#voiceVolume').addEventListener('input', e => {
    state.voiceVolume = Number(e.target.value);
    $('#voiceVolumeValue').textContent = state.voiceVolume + '%';
    save();
  });
  $('#voiceMixer').addEventListener('click', () => window.chrome.webview.postMessage('window:mixer'));
  $('#voicePreview').addEventListener('click', () => speak('The train from the south pulled into Haizhou at ten past seven.'));

  function speak(text, btn) { speakItems([{text: String(text)}], btn); }

  function stopSpeech() {
    speech.token++;
    if (speech.btn) {
      if (speech.label) {
        speech.btn.textContent = speech.label;
        speech.btn.setAttribute('aria-label', speech.label);
      }
      speech.btn.classList.remove('is-on');
      speech.btn.removeAttribute('aria-pressed');
    }
    if (speech.progress) speech.progress.hidden = true;
    speech.btn = speech.label = speech.progress = speech.utterance = null;
    speech.paused = false;
    speech.resumeNext = null;
    if (speech.audio) { speech.audio.pause(); speech.audio.removeAttribute('src'); speech.audio = null; }
    if (onNativeSpeechDone) { onNativeSpeechDone = null; nativeSpeech('stop'); }
    speech.native = false;
    if (synth) { synth.cancel(); if (synth.paused) synth.resume(); }
    clearKaraoke();
  }

  function clearKaraoke() {
    $$('.karaoke').forEach(k => k.remove());
    $$('.srow.is-speaking').forEach(r => r.classList.remove('is-speaking'));
  }

  /* 在 el 里给 [start, start+len) 这段文字铺一块高亮 */
  function paintWord(host, textEl, start, len) {
    var walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT, null);
    var map = [], acc = 0, node;
    while ((node = walker.nextNode())) {
      map.push({ node: node, start: acc, end: acc + node.nodeValue.length });
      acc += node.nodeValue.length;
    }
    if (!map.length) return;
    var s = Math.max(0, start), e = Math.min(acc, start + Math.max(len, 1));
    if (e <= s) return;
    var a = null, b = null, i;
    for (i = 0; i < map.length; i++) {
      if (!a && map[i].start <= s && s < map[i].end) a = map[i];
      if (map[i].start < e && e <= map[i].end) { b = map[i]; break; }
    }
    if (!a) a = map[0];
    if (!b) b = map[map.length - 1];
    var range = document.createRange();
    try {
      range.setStart(a.node, s - a.start);
      range.setEnd(b.node, e - b.start);
    } catch (e2) { return; }
    var rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    var base = host.getBoundingClientRect();
    var old = host.querySelector('.karaoke');
    if (old) old.parentNode.removeChild(old);
    var k = document.createElement('span');
    k.className = 'karaoke on';
    k.style.left = (rect.left - base.left) + 'px';
    k.style.top = (rect.top - base.top) + 'px';
    k.style.width = rect.width + 'px';
    k.style.height = rect.height + 'px';
    host.appendChild(k);
  }

  // Speak individual sentences in sequence: progress advances even on voices
  // that provide no word boundary events.
  function speakItems(items, btn) {
    if ((!synth || !window.SpeechSynthesisUtterance) && !window.wordYarnDesktop) { toast('当前设备不支持朗读'); return; }
    var para = btn?.matches('[data-say-para]') ? btn.closest('.para') : null;
    if (para && speech.btn === btn) {
      speech.paused = !speech.paused;
      if (speech.audio) {
        if (speech.paused) speech.audio.pause();
        else speech.audio.play().catch(() => { stopSpeech(); toast('无法播放增强语音'); });
      } else if (speech.native) nativeSpeech(speech.paused ? 'pause' : 'resume');
      else if (speech.paused) synth.pause(); else synth.resume();
      btn.textContent = speech.paused ? '继续播放' : '暂停';
      btn.setAttribute('aria-label', btn.textContent);
      btn.setAttribute('aria-pressed', String(!speech.paused));
      if (!speech.paused && speech.resumeNext) {
        var resumeNext = speech.resumeNext;
        speech.resumeNext = null;
        resumeNext();
      }
      return;
    }
    stopSpeech();
    items = items.filter(it => it.text);
    if (!items.length) return;
    var token = speech.token;
    speech.btn = btn || null;
    speech.progress = para?.querySelector('.para-playback');
    if (btn) btn.classList.add('is-on');
    if (para) {
      speech.label = btn.textContent;
      btn.textContent = '暂停';
      btn.setAttribute('aria-label', btn.textContent);
      btn.setAttribute('aria-pressed', 'true');
      speech.progress.hidden = false;
    }
    var voice = pickVoice();
    speech.native = Boolean(window.wordYarnDesktop &&
      (!voice || !window.SpeechSynthesisUtterance || (!state.voice && voiceVolume() > 100)));
    function next(i) {
      if (token !== speech.token) return;
      if (speech.paused) { speech.resumeNext = () => next(i); return; }
      clearKaraoke();
      if (i >= items.length) {
        if (speech.progress) {
          var panel = speech.progress;
          stopSpeech();
          panel.hidden = false;
          panel.querySelector('progress').value = items.length;
          panel.querySelector('span').textContent = '播放完成';
        } else stopSpeech();
        return;
      }
      var it = items[i];
      function progress(f) {
        if (!speech.progress) return;
        var meter = speech.progress.querySelector('progress');
        meter.max = items.length;
        meter.value = i + f;
        speech.progress.querySelector('span').textContent = (i + 1) + ' / ' + items.length + ' 句';
      }
      progress(0);
      if (speech.native) {
        it.host?.closest('.srow')?.classList.add('is-speaking');
        onNativeSpeechDone = function (ok, audio) {
          if (token !== speech.token) return;
          if (ok && audio) {
            var clip = new Audio('data:audio/wav;base64,' + audio);
            speech.audio = clip;
            clip.onended = () => { if (token === speech.token) { speech.audio = null; next(i+1); } };
            clip.onerror = () => { if (token === speech.token) { stopSpeech(); toast('无法播放增强语音'); } };
            clip.ontimeupdate = () => { if (token === speech.token && clip.duration) progress(Math.min(.99, clip.currentTime / clip.duration)); };
            if (!speech.paused) clip.play().catch(() => { if (token === speech.token && !speech.paused) { stopSpeech(); toast('无法播放增强语音'); } });
          } else if (ok) next(i + 1);
          else { stopSpeech(); toast('找不到可用的英语语音，请检查 Windows 语音设置'); }
        };
        var speed = Math.round((Number(state.voiceRate || 0.94) - 1) * 10);
        nativeSpeech('play:' + (++speechStep) + ':' + speed + ':' + voiceVolume() + ':' + it.text.slice(0,1800));
        return;
      }
      var u = new SpeechSynthesisUtterance(it.text);
      speech.utterance = u;
      u.lang = voice?.lang || 'en-US';
      if (voice) u.voice = voice;
      u.rate = Number(state.voiceRate || 0.94);
      u.volume = Math.min(100, voiceVolume()) / 100;
      u.pitch = 1;
      u.onstart = function () {
        if (token === speech.token) it.host?.closest('.srow')?.classList.add('is-speaking');
      };
      u.onboundary = function (e) {
        if (token !== speech.token) return;
        var idx = e.charIndex || 0, len = e.charLength || (/^\S+/.exec(it.text.slice(idx))?.[0].length || 1);
        progress(Math.min(0.99, idx / it.text.length));
        if (it.host && it.textEl) paintWord(it.host, it.textEl, idx, len);
      };
      u.onend = function () { next(i + 1); };
      u.onerror = function (e) {
        if (token !== speech.token) return;
        stopSpeech();
        if (!['canceled','interrupted'].includes(e.error))
          toast(e.error === 'not-allowed' ? '请点击朗读按钮启用声音' : '无法朗读，请在朗读设置中更换音色');
      };
      synth.speak(u);
    }
    $$('.para-playback').forEach(p => { if (p !== speech.progress) p.hidden = true; });
    next(0);
  }

  function sentenceItem(gi) {
    var s = flatIdx[gi];
    if (!s) return null;
    var row = document.querySelector('.srow[data-gi="' + gi + '"]');
    if (!row) return null;
    var host = row.querySelector('.sen');
    var textEl = row.querySelector('.sen-text');
    if (!host || !textEl) return null;
    return { text: s.en, host: host, textEl: textEl, gi: gi };
  }

  function saySentence(gi, btn) {
    var para = btn.closest('.para');
    if (para && para.dataset.open !== 'true') {
      para.dataset.open = 'true';
      var st = $('.para-state', para);
      if (st) st.textContent = '逐句对照';
      if (!state.open[current.id]) state.open[current.id] = {};
      state.open[current.id][para.dataset.para] = true;
      save();
    }
    var item = sentenceItem(gi);
    if (!item) return;
    speakItems([item], btn);
  }

  function sayParagraph(paraId, btn) {
    var para = document.querySelector('.para[data-para="' + paraId + '"]');
    if (!para) return;
    if (para.dataset.open !== 'true') {
      para.dataset.open = 'true';
      var st = $('.para-state', para);
      if (st) st.textContent = '逐句对照';
      if (!state.open[current.id]) state.open[current.id] = {};
      state.open[current.id][paraId] = true;
      save();
    }
    var items = $$('.srow', para).map(function (row) {
      var gi = +row.dataset.gi;
      var s = flatIdx[gi];
      var host = row.querySelector('.sen');
      var textEl = row.querySelector('.sen-text');
      if (!s || !host || !textEl) return null;
      return { text: s.en, host: host, textEl: textEl, gi: gi };
    }).filter(Boolean);
    if (!items.length) return;
    speakItems(items, btn);
  }

  /* ---------- 提示条 ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1900);
  }

  /* ---------- 视图切换 ---------- */
  function setView(v, silent) {
    $('#vocabReturn')?.setAttribute('hidden', '');
    state.view = v; save(); closePop(); stopSpeech();
    $$('.tab').forEach(function (t) {
      var on = t.dataset.view === v;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ['read', 'vocab', 'cards', 'today', 'dictionary', 'profile'].forEach(function (x) { $('#view-' + x).hidden = (x !== v); });
    if (current) {
      if (v === 'vocab') renderVocab(current);
      if (v === 'cards') {
        restoreCardPos(current, false);
        renderCards(current);
        if (!silent || window.wordYarnDesktop) playCard();
      }
    }
    if (!silent) syncHash();
    if (v === 'today' || v === 'profile') { study.render(); study.sync(); }
    if (v === 'dictionary' && !isNarrow()) $('#globalQuery').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function syncHash() {
    var h = '#' + state.chapter + '/' + state.view;
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    var m = /^#(\w+)(?:\/(\w+))?$/.exec(location.hash || '');
    if (!m) return null;
    var id = m[1], v = m[2] || 'read';
    var ok = manifest.some(function (x) { return x.id === id; });
    if (!ok) return null;
    if (['read', 'vocab', 'cards', 'today', 'dictionary', 'profile'].indexOf(v) < 0) v = 'read';
    return { chapter: id, view: v };
  }

  function showChapter(id, silent) {
    var version = ++chapterVersion;
    if (readingObserver) readingObserver.disconnect();
    vocabReturn = null; stopSpeech();
    state.chapter = id; save();
    closePop();
    return loadChapter(id).then(function (ch) {
      if (version !== chapterVersion) return;
      current = ch;
      buildIndex(ch);
      renderTop();
      renderSidebar();
      // Start every opened chapter in bilingual mode. Toggles still work while reading it.
      state.open[ch.id] = {};
      renderRead(ch);
      observeReading(ch, version);
      if (state.view === 'vocab') renderVocab(ch);
      if (state.view === 'cards') { restoreCardPos(ch, false); renderCards(ch); if (!silent || window.wordYarnDesktop) playCard(); }
      if (!silent) syncHash();
    }).catch(function (err) {
      if (version !== chapterVersion) return;
      console.error(err);
      toast('章节数据加载失败');
    });
  }

  function observeReading(ch, version) {
    readingObserver = new IntersectionObserver(function (entries) {
      if (version !== chapterVersion || state.view !== 'read') return;
      var found = entries.filter(function (entry) { return entry.isIntersecting; }).pop();
      if (found) study.position(ch.id, found.target.dataset.para);
    }, { rootMargin: '-27% 0px -68% 0px' });
    $$('.para').forEach(function (p) { readingObserver.observe(p); });
  }

  async function goStudy(chapter, paragraph, index) {
    if (current?.id !== chapter || state.chapter !== chapter) await showChapter(chapter, true);
    if (current?.id !== chapter || state.chapter !== chapter) return;
    if (index != null) { jumpTo(index); return; }
    setView('read');
    var p = $$('.para').find(function (el) { return el.dataset.para === paragraph; });
    if (p) {
      study.position(chapter, paragraph);
      p.scrollIntoView({ block: 'start' });
    }
  }

  /* ---------- 跳转定位 ---------- */
  function jumpTo(gi) {
    var s = flatIdx[gi];
    if (!s) return;
    setView('read');
    var para = $('.para[data-para="p' + (s._pi + 1) + '"]');
    if (!para) return;
    para.dataset.open = 'true';
    if (!state.open[current.id]) state.open[current.id] = {};
    state.open[current.id]['p' + (s._pi + 1)] = true; save();
    var st = $('.para-state', para);
    if (st) st.textContent = '逐句对照';
    var tg = $('.para-toggle', para);
    if (tg) tg.setAttribute('aria-expanded', 'true');
    $$('.srow.is-flash').forEach(row => row.classList.remove('is-flash'));
    setTimeout(function () {
      var row = $('.srow[data-gi="' + gi + '"]', para);
      if (!row) return;
      row.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
      row.classList.remove('is-flash');
      void row.offsetWidth;
      row.classList.add('is-flash');
    }, 90);
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;

    // 侧栏开合
    if (t.closest('#btnNav')) { toggleNav(); return; }

    // 朗读：整段 / 单句（必须排在段落展开之前，否则会误触发折叠）
    var sayPara = t.closest('[data-say-para]');
    if (sayPara) { sayParagraph(sayPara.dataset.sayPara, sayPara); return; }
    var saySen = t.closest('[data-say-sen]');
    if (saySen) { saySentence(+saySen.dataset.saySen, saySen); return; }

    // 闪卡翻页
    var nav = t.closest('[data-nav]');
    if (nav) { goCard(+nav.dataset.nav); return; }
    if (t.closest('[data-restart]') && current) { restoreCardPos(current, true); goCard(0); return; }
    if (t.closest('[data-retry-cards]') && current) { restoreCardPos(current, false); goCard(0); return; }
    if (t.closest('[data-card-play]')) {
      var cv = cardQueue[cardAt];
      if (cv) speakItems([{text:cv.lemma}, {text:cv.ex?.en || ''}]);
      return;
    }
    if (t.closest('[data-card-audio]')) { state.cardAudio = state.cardAudio === false; save(); goCard(0); return; }

    // 侧栏章节
    var chBtn = t.closest('.ch-item');
    if (chBtn) {
      if (state.view === 'today' || state.view === 'dictionary' || state.view === 'profile') setView('read', true);
      showChapter(chBtn.dataset.ch);
      if (isNarrow()) toggleNav(false);
      return;
    }

    // 标签页
    var tab = t.closest('.tab');
    if (tab) { setView(tab.dataset.view); return; }

    // 段落展开
    var bar = t.closest('.para-bar');
    if (bar) {
      var para = bar.closest('.para');
      var open = para.dataset.open !== 'true';
      para.dataset.open = open ? 'true' : 'false';
      var st = $('.para-state', para);
      if (st) st.textContent = open ? '逐句对照' : '连续阅读';
      var tg = $('.para-toggle', para);
      if (tg) tg.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!state.open[current.id]) state.open[current.id] = {};
      state.open[current.id][para.dataset.para] = open;
      save();
      return;
    }

    // 全部展开 / 收起
    var all = t.closest('[data-all]');
    if (all) {
      var want = all.dataset.all === 'open';
      $$('.para').forEach(function (p) {
        p.dataset.open = want ? 'true' : 'false';
        var s = $('.para-state', p);
        if (s) s.textContent = want ? '逐句对照' : '连续阅读';
        var tg = $('.para-toggle', p);
        if (tg) tg.setAttribute('aria-expanded', want ? 'true' : 'false');
        if (!state.open[current.id]) state.open[current.id] = {};
        state.open[current.id][p.dataset.para] = want;
      });
      save();
      return;
    }

    // 词表筛选 / 排序
    var f = t.closest('#vFilter button');
    if (f) { state.filter = f.dataset.f; save(); renderVocab(current); return; }
    var so = t.closest('#vSort button');
    if (so) { state.sort = so.dataset.s; save(); renderVocab(current); return; }

    // 定位
    var jump = t.closest('[data-jump]');
    if (jump) {
      var cardEntry = jump.closest('.card');
      vocabReturn = { chapter: state.chapter, y: window.scrollY, lemma: cardEntry?.dataset.w };
      jumpTo(+jump.dataset.jump);
      $('#vocabReturn').hidden = false;
      return;
    }
    if (t.closest('[data-vocab-return]') && vocabReturn) {
      var previous = vocabReturn; vocabReturn = null;
      setView('vocab');
      window.scrollTo(0, previous.y);
      var anchor = $$('.card').find(function (c) { return c.dataset.w === previous.lemma; });
      anchor?.querySelector('[data-jump]')?.focus({preventScroll:true});
      return;
    }

    // 朗读
    var sp = t.closest('[data-speak]');
    if (sp) { speak(sp.dataset.speak); return; }

    // 掌握度
    var rate = t.closest('[data-rate]');
    if (rate) {
      if (state.view === 'cards' && rate.closest('.fc-actions')) {
        nextCard(rate.dataset.rate);
        return;
      }
      var card = rate.closest('.card');
      var lemma = card ? card.dataset.w : (current ? lemmaFromPop() : null);
      if (lemma) {
        setStatus(lemma, rate.dataset.rate);
        if (card) {
          card.dataset.status = rate.dataset.rate;
          $$('.rates button', card).forEach(function (b) { b.classList.remove('on'); });
          rate.classList.add('on');
        } else {
          var inPop = rate.closest('#pop');
          if (inPop) {
            $$('.rates button', inPop).forEach(function (b) { b.classList.remove('on'); });
            rate.classList.add('on');
          }
        }
      }
      return;
    }

    // 句中目标词
    var w = t.closest('.w');
    if (w) { openPop(w.dataset.w, w); return; }

    // 关闭浮层
    if (t.closest('[data-pop-close]')) { closePop(); return; }
    if (!t.closest('#pop')) closePop();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePop(); stopSpeech(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      var w = document.activeElement;
      if (w && w.classList && w.classList.contains('w')) {
        e.preventDefault(); openPop(w.dataset.w, w); return;
      }
      if (w && w.id === 'fcCard') { e.preventDefault(); flipCard(); }
    }
    if ($('#studyExercise').open || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (state.view === 'cards' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (/^[1-3]$/.test(e.key)) {
        if (e.repeat) return;
        var map = { '1': 'new', '2': 'fuzzy', '3': 'known' };
        nextCard(map[e.key]);
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goCard(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); goCard(1); return; }
    }
  });

  function lemmaFromPop() {
    var pop = $('#pop');
    return pop.hidden ? null : pop.dataset.lemma;
  }

  function flipCard() {
    var c = $('#fcCard');
    if (!c) return;
    cardFlipped = !cardFlipped;
    c.classList.toggle('is-flipped', cardFlipped);
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#fcCard') && !e.target.closest('button')) flipCard();
  });

  // 搜索框
  document.addEventListener('input', function (e) {
    if (e.target.id === 'vocabSearch') {
      state.query = e.target.value;
      var pos = e.target.selectionStart;
      renderVocab(current);
      var inp = $('#vocabSearch');
      if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    }
  });

  // 顶栏工具
  $('#btnBigger').addEventListener('click', function () { setSize(state.enSize + 1); });
  $('#btnSmaller').addEventListener('click', function () { setSize(state.enSize - 1); });
  function setSize(n) {
    state.enSize = Math.min(23, Math.max(14, n));
    document.documentElement.style.setProperty('--en-size', state.enSize + 'px');
    document.documentElement.style.setProperty('--cn-size', (state.enSize - 1.5) + 'px');
    save();
  }
  $('#btnTheme').addEventListener('click', function () {
    state.theme = state.theme === 'night' ? 'paper' : 'night';
    document.documentElement.dataset.theme = state.theme;
    var ch = state.theme === 'night' ? '昼' : '夜';
    $('#themeChar').textContent = ch;
    $('#btnTheme').setAttribute('aria-label', ch + ' 切换昼夜');
    save();
  });

  /* ---------- 启动 ---------- */
  document.documentElement.dataset.theme = state.theme;
  $('#themeChar').textContent = state.theme === 'night' ? '昼' : '夜';
  $('#btnTheme').setAttribute('aria-label', (state.theme === 'night' ? '昼' : '夜') + ' 切换昼夜');
  setSize(state.enSize);
  applyNav();
  renderSidebar();
  $('#chList').addEventListener('scroll', updateSideScroll, { passive: true });
  window.addEventListener('resize', updateSideScroll);
  compactNav.addEventListener('change', () => { drawerOpen = false; applyNav(); });
  document.addEventListener('click', function (e) {
    if (!isNarrow() || !drawerOpen) return;
    if (e.target.closest('#sidebar') || e.target.closest('#btnNav')) return;
    toggleNav(false);
  }, true);
  study = window.createStudy({
    $: $, esc: esc, state: state, manifest: manifest, load: loadChapter,
    save: save, toast: toast, refresh: renderSidebar, go: goStudy,
    speak: speak, stopSpeech: stopSpeech,
    openVocab: async function (chapter) {
      state.query = ''; state.filter = 'all';
      if (current?.id !== chapter) await showChapter(chapter, true);
      if (current?.id === chapter) setView('vocab');
    },
    current: function () { return current; }
  });
  var h = readHash();
  if (!h && location.protocol !== 'file:') state.view = 'today';
  if (h) { state.chapter = h.chapter; state.view = h.view; }
  setView(state.view || 'read', true);
  showChapter(state.chapter, true).then(function () {
    syncHash();
  });
  window.addEventListener('resize', closePop);
  if (window.wordYarnDesktop) {
    var titleBar = $('#desktopTitle');
    titleBar.hidden = false;
    document.documentElement.classList.add('desktop-app');
    var windowAction = action => window.chrome.webview.postMessage('window:' + action);
    titleBar.addEventListener('click', e => { var button = e.target.closest('[data-window]'); if (button) windowAction(button.dataset.window); });
    titleBar.addEventListener('dblclick', e => {
      if (!e.target.closest('button')) windowAction('fullscreen');
    });
    var dragStart;
    titleBar.addEventListener('pointerdown', e => {
      if (e.button === 0 && titleBar.dataset.fullscreen === 'false' && !e.target.closest('button'))
        dragStart = { x: e.screenX, y: e.screenY };
    });
    titleBar.addEventListener('pointermove', e => {
      if (!(e.buttons & 1)) { dragStart = null; return; }
      if (dragStart && Math.hypot(e.screenX - dragStart.x, e.screenY - dragStart.y) >= 6) {
        dragStart = null;
        windowAction('move');
      }
    });
    titleBar.addEventListener('pointerup', () => { dragStart = null; });
    titleBar.addEventListener('pointercancel', () => { dragStart = null; });
    window.addEventListener('keydown', e => { if (e.key === 'F11') { e.preventDefault(); windowAction('fullscreen'); } });
    window.wordYarnWindowState = function (full) {
      var button = $('[data-window=fullscreen]');
      titleBar.dataset.fullscreen = String(full);
      var label = full ? '退出全屏' : '进入全屏';
      button.setAttribute('aria-label', label); button.title = label + '（F11）';
      button.textContent = full ? '⧉' : '□';
    };
    window.wordYarnWindowState(true);
  }
  window.addEventListener('hashchange', function () {
    var x = readHash();
    if (!x) return;
    if (x.chapter !== state.chapter) {
      showChapter(x.chapter, true).then(function () { setView(x.view, true); });
      return;
    }
    if (x.view !== state.view) setView(x.view, true);
  });
})();
