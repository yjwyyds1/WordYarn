(function () {
  'use strict';
  window.createStudy = function (ui) {
    const key = 'cet4.study.v1';
    const outbox = 'cet4.study.event.';
    let local = { position: null, words: {}, pending: [], migrated: false };
    try { Object.assign(local, JSON.parse(localStorage.getItem(key) || '{}')); } catch {}
    let snapshot, connected = false, syncing, revision = 0, tried = false;
    let queue = [], item = null, searchIndex, searchVersion = 0;
    const $ = ui.$, esc = ui.esc;
    const ratings = { new: '没想起来', fuzzy: '有点模糊', known: '想起来了' };
    const serverPossible = location.protocol !== 'file:';
    const id = () => crypto.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
    function pending() {
      const stored = [];
      try {
        for (const name of Object.keys(localStorage)) {
          if (name.startsWith(outbox)) {
            const event = JSON.parse(localStorage.getItem(name));
            if (event) stored.push({ ...event, name });
          }
        }
      } catch {}
      return stored.sort((a, b) => a.time - b.time).concat(local.pending);
    }
    function add(path, payload) {
      const event = { path, payload, time: Date.now() };
      try { localStorage.setItem(outbox + id(), JSON.stringify(event)); }
      catch { local.pending.push(event); }
    }
    function save() {
      try { localStorage.setItem(key, JSON.stringify(local)); }
      catch { ui.toast('浏览器无法保存备份，请检查存储设置'); }
    }
    async function api(path, payload) {
      const response = await fetch('api/' + path, {
        cache: 'no-store', signal: AbortSignal.timeout(4000),
        ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {})
      });
      if (!response.ok) throw Error('HTTP ' + response.status);
      return response.json();
    }
    function words() {
      return Object.values(local.words);
    }
    function due() {
      if (connected && snapshot && !pending().length) return snapshot.due;
      return words().filter(w => w.dueAt <= Date.now() / 1000).sort((a, b) => a.dueAt - b.dueAt);
    }
    function label(p) {
      const ch = ui.manifest.find(m => m.id === p.chapter);
      return ch ? '第 ' + ch.no + ' 章 · ' + ch.titleCn + ' · 第 ' + Number(p.paragraph.slice(1)) + ' 段' : '第 1 章 · 初到海州';
    }
    function render() {
      const p = local.position || { chapter: 'ch01', paragraph: 'p1' };
      $('#continueDetail').textContent = label(p);
      $('#continueStudy').textContent = local.position ? '继续阅读' : '开始阅读';
      const count = due().length;
      $('#dueCount').textContent = count;
      $('#startDue').disabled = !count;
      $('#reviewSummary').textContent = snapshot
        ? '已答题 ' + snapshot.reviewCount + ' 次 · 到期复习中连续想起至少两次：' + snapshot.remembered + ' 词'
        : '每次先回忆，再核对原句和词义。';
      $('#studyConnection').textContent = connected && !pending().length ? '已保存到 SQLite' :
        tried || !serverPossible ? '本地模式 · 学习记录暂存在此浏览器' : '正在连接学习服务…';
      $('#historyStudy').hidden = !connected;
    }
    function sync() {
      if (!serverPossible || syncing) return syncing;
      const flush = async function () {
        try {
          let remote = await api('study');
          if (!local.migrated) {
            const existing = new Set(remote.words.map(w => w.chapter + ':' + w.lemma));
            for (const chapter of Object.keys(ui.state.status)) {
              for (const [lemma, rating] of Object.entries(ui.state.status[chapter])) {
                const id = chapter + ':' + lemma;
                if (!existing.has(id) && !local.words[id] && Object.hasOwn(ratings, rating))
                  add('mark', { chapter, lemma, rating });
              }
            }
            local.migrated = true; save();
          }
          do {
            for (const event of pending()) {
              await api(event.path, event.payload);
              if (event.name) localStorage.removeItem(event.name);
              else local.pending = local.pending.filter(e => e !== event);
              save();
            }
            const before = revision;
            remote = await api('study');
            if (before === revision && !pending().length) break;
          } while (true);
          snapshot = remote;
          local.position = remote.position;
          local.words = Object.fromEntries(remote.words.map(w => [w.chapter + ':' + w.lemma, w]));
          for (const w of remote.words) {
            (ui.state.status[w.chapter] ||= {})[w.lemma] = w.rating;
          }
          ui.save(); ui.refresh();
          connected = true; save();
        } catch { connected = false; }
        finally { tried = true; syncing = null; render(); }
      };
      syncing = (navigator.locks
        ? navigator.locks.request(key, flush)
        : Promise.resolve().then(flush));
      return syncing;
    }
    function enqueue(path, payload) {
      ++revision;
      if (serverPossible) add(path, payload);
      save(); render(); sync();
    }
    function position(chapter, paragraph) {
      if (!chapter || !paragraph || (local.position?.chapter === chapter && local.position.paragraph === paragraph)) return;
      local.position = { chapter, paragraph };
      enqueue('position', local.position);
    }
    function rate(chapter, lemma, rating, review) {
      const payload = { chapter, lemma, rating };
      if (review) {
        payload.attempt = id();
        payload.reviewedAt = Math.floor(Date.now() / 1000);
      }
      const delay = rating === 'known' ? 86400 : review ? (rating === 'new' ? 600 : 86400) : 0;
      local.words[chapter + ':' + lemma] = { ...payload, dueAt: Math.floor(Date.now() / 1000) + delay };
      enqueue(review ? 'review' : 'mark', payload);
    }
    async function buildDictionary() {
      const list = await Promise.all(ui.manifest.map(m => ui.load(m.id)));
      return list.flatMap(ch => {
        const sentences = ch.paragraphs.flatMap(p => p.sentences);
        return ch.vocab.map(v => ({
          ...v, chapter: ch.id, title: ch.titleCn,
          origin: v.origin ?? sentences.findIndex(s => s.words?.some(w => w.w === v.lemma))
        }));
      });
    }
    async function search() {
      const version = ++searchVersion;
      const q = $('#globalQuery').value.trim().toLowerCase();
      const output = $('#dictionaryResults');
      if (!q) { output.textContent = '输入英文单词或中文释义。'; return; }
      output.textContent = '正在检索故事词库…';
      try {
        searchIndex ||= buildDictionary().catch(e => { searchIndex = null; throw e; });
        const all = await searchIndex;
        if (version !== searchVersion) return;
        const matches = all.filter(v => v.lemma.includes(q) || v.def.includes(q))
          .sort((a, b) => (b.lemma === q) - (a.lemma === q) || Number(b.lemma.startsWith(q)) - Number(a.lemma.startsWith(q)));
        output.innerHTML = matches.length ? '<p class="study-muted" role="status">找到 ' + matches.length + ' 个义项' +
          (matches.length > 30 ? '，显示前 30 个' : '') + '</p>' + matches.slice(0, 30).map(v =>
          '<article class="dictionary-entry"><div><strong>' + esc(v.w) + '</strong> <small>' + esc(v.pos) +
          '</small><p>' + esc(v.def) + '</p></div>' + (v.origin >= 0
            ? '<button class="btn" data-study-origin="' + esc(v.chapter) + ':' + v.origin + '">原句 · ' + esc(v.title) + '</button>' : '') +
          '</article>').join('') : '没有找到匹配的词。';
      } catch { if (version === searchVersion) output.textContent = '词库加载失败，请重试。'; }
    }
    async function next() {
      const panel = $('#studyExercise');
      if (!panel.open) return;
      item = null;
      panel.querySelector('.exercise-content').textContent = '正在准备原句…';
      const w = queue.shift();
      if (!w) {
        panel.querySelector('.exercise-content').innerHTML = '<p>这组练习完成了。</p><button class="btn" data-study-close>完成</button>';
        return;
      }
      try {
        const ch = await ui.load(w.chapter);
        if (!panel.open) return;
        const sentences = ch.paragraphs.flatMap(p => p.sentences);
        const vocab = ch.vocab.filter(v => v.lemma === w.lemma);
        const index = w.origin ?? vocab.find(v => v.origin != null)?.origin ??
          sentences.findIndex(s => s.words?.some(t => t.w === w.lemma));
        const sentence = sentences[index];
        const tokens = sentence?.words?.filter(t => t.w === w.lemma) || [];
        let prompt = sentence?.en || w.lemma;
        for (const t of tokens.slice().reverse())
          prompt = prompt.slice(0, t.at) + '____' + prompt.slice(t.at + t.len);
        const answers = [...new Set(tokens.map(t => sentence.en.slice(t.at, t.at + t.len)))];
        item = { ...w, answers, index, sentence, vocab };
        panel.querySelector('.exercise-content').innerHTML =
          '<p class="study-muted">' + esc(ch.titleCn) + ' · 本组还剩 ' + (queue.length + 1) + ' 词</p>' +
          '<p class="exercise-sentence">' + esc(prompt) + '</p>' +
          '<form id="exerciseForm"><label for="exerciseAnswer">' + (answers.length ? '填入原句中的单词' : '先回忆词义') +
          '</label>' + (answers.length ? '<input id="exerciseAnswer" autocomplete="off" spellcheck="false">' : '') +
          '<button class="btn primary-study">核对答案</button></form>' +
          '<div id="exerciseReveal" hidden></div>';
        ($('#exerciseAnswer') || $('#exerciseForm button')).focus();
      } catch {
        queue.unshift(w);
        panel.querySelector('.exercise-content').innerHTML = '<p>章节加载失败。</p><button class="btn" data-study-retry>重试</button>';
      }
    }
    function start(items) {
      if (!items.length) return;
      queue = items.slice(0, 10);
      const panel = $('#studyExercise');
      if (!panel.open) panel.showModal();
      next();
    }
    function reveal() {
      if (!item) return;
      const answer = $('#exerciseAnswer')?.value.trim().toLowerCase() || '';
      const match = item.answers.some(a => a.toLowerCase() === answer);
      $('#exerciseForm').hidden = true;
      const panel = $('#exerciseReveal');
      panel.innerHTML = (answer ? '<p class="study-muted">' + (match ? '答对了' : '正确词形：' + esc(item.answers.join(' / '))) + '</p>' : '') +
        '<p class="exercise-sentence">' + esc(item.sentence?.en || item.lemma) + '</p>' +
        '<p>' + esc(item.sentence?.cn || '') + '</p>' +
        '<p>' + item.vocab.map(v => esc(v.pos + ' ' + v.def)).join('；') + '</p>' +
        (item.index >= 0 ? '<button class="btn" data-study-origin="' + esc(item.chapter) + ':' + item.index + '">回到原句</button>' : '') +
        '<div class="study-actions">' + Object.entries(ratings).map(([id, label]) =>
          '<button class="btn" data-study-rate="' + id + '">' + label + '</button>').join('') + '</div>';
      panel.hidden = false;
      panel.querySelector('[data-study-rate]').focus();
    }
    document.addEventListener('click', async function (e) {
      const t = e.target;
      if (t.closest('#continueStudy')) {
        const p = local.position || { chapter: 'ch01', paragraph: 'p1' };
        await ui.go(p.chapter, p.paragraph);
      } else if (t.closest('#startDue')) {
        if (syncing) await syncing;
        start(due());
      } else if (t.closest('[data-study-practice]')) {
        const paragraph = ui.current()?.paragraphs.find(p => p.id === t.closest('[data-study-practice]').dataset.studyPractice);
        if (!paragraph) return;
        const chapter = ui.current().id, seen = new Set(), items = [];
        for (const s of paragraph.sentences) {
          for (const token of s.words || []) {
            if (seen.has(token.w)) continue;
            seen.add(token.w);
            const saved = local.words[chapter + ':' + token.w];
            items.push({ chapter, lemma: token.w, origin: s._gi, priority: saved?.rating === 'known' ? 2 : saved ? 0 : 1 });
          }
        }
        items.sort((a, b) => a.priority - b.priority);
        if (items.length) start(items.slice(0, 4));
        else ui.toast('本段没有目标词');
      } else if (t.closest('[data-study-rate]') && item) {
        const w = item, rating = t.closest('[data-study-rate]').dataset.studyRate;
        item = null;
        (ui.state.status[w.chapter] ||= {})[w.lemma] = rating;
        ui.save(); ui.refresh();
        rate(w.chapter, w.lemma, rating, true);
        next();
      } else if (t.closest('[data-study-origin]')) {
        const [chapter, index] = t.closest('[data-study-origin]').dataset.studyOrigin.split(':');
        if ($('#studyExercise').open) $('#studyExercise').close();
        await ui.go(chapter, null, Number(index));
      } else if (t.closest('[data-study-close]')) {
        $('#studyExercise').close();
      } else if (t.closest('[data-study-retry]')) {
        next();
      } else if (t.closest('#historyStudy')) {
        const target = $('#studyHistory');
        if (!target.hidden) { target.hidden = true; return; }
        target.hidden = false; target.textContent = '正在加载…';
        try {
          const history = await api('history');
          target.innerHTML = history.length ? '<ol>' + history.slice(0, 15).map(h =>
            '<li>' + esc(h.lemma + ' · ' + ratings[h.rating] + ' · ' + new Date(h.reviewedAt * 1000).toLocaleString()) + '</li>').join('') +
            '</ol>' : '还没有答题记录。';
        } catch { target.textContent = '答题记录加载失败。'; }
      }
    });
    document.addEventListener('submit', e => {
      if (e.target.id === 'exerciseForm') { e.preventDefault(); reveal(); }
      if (e.target.id === 'globalSearch') { e.preventDefault(); search(); }
    });
    $('#globalQuery').addEventListener('input', search);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); sync(); } });
    window.addEventListener('online', sync);
    setInterval(() => { if (!document.hidden && $('#view-today').hidden === false) { render(); sync(); } }, 30000);
    render(); sync();
    return { position, rate, render, sync };
  };
})();
