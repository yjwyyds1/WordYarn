(function () {
  'use strict';
  window.createStudy = function (ui) {
    const key = 'cet4.study.v1';
    const outbox = 'cet4.study.event.';
    let local = { position: null, words: {}, pending: [], migrated: false, activity: {}, reviewCount: 0 };
    try { Object.assign(local, JSON.parse(localStorage.getItem(key) || '{}')); } catch {}
    let snapshot, connected = false, syncing, revision = 0, tried = false, closing = false;
    let queue = [], item = null, searchIndex, searchVersion = 0, exerciseMode, exerciseVersion = 0;
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
      const headers = {};
      if (payload) headers['Content-Type'] = 'application/json';
      if (window.wordYarnDesktop?.token) headers['X-CET4-Token'] = window.wordYarnDesktop.token;
      const response = await fetch('api/' + path, {
        cache: 'no-store', signal: AbortSignal.timeout(4000), headers,
        ...(payload ? { method: 'POST', body: JSON.stringify(payload) } : {})
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
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeLabel = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
    function estimate(previous, rating, review, now) {
      let streak = 0;
      let dueAt = now + (rating === 'known' ? 86400 : 0);
      if (review) {
        if (rating === 'new') dueAt = now + 600;
        else if (rating === 'fuzzy') dueAt = now + 12 * 3600;
        else {
          streak = previous && previous.dueAt > now ? (previous.streak || 0) : (previous?.streak || 0) + 1;
          dueAt = previous && previous.dueAt > now ? previous.dueAt : now + [1,3,7,15,30][Math.max(0,Math.min(4,streak-1))] * 86400;
        }
      }
      return { dueAt, streak };
    }
    function reviewPlan(now, vocabulary) {
      const nextWeek = Array.from({length:7}, (_, i) => new Date(now + i * 86400000).toISOString().slice(0,10));
      const counts = Object.fromEntries(nextWeek.map(d=>[d,0]));
      const clock = Date.now()/1000;
      let overdue = 0;
      for (const w of vocabulary) {
        if (w.dueAt <= clock) overdue++;
        else {
          const date = day.format(new Date(w.dueAt * 1000));
          if (Object.hasOwn(counts,date)) counts[date]++;
        }
      }
      const max = Math.max(1,...Object.values(counts));
      return '<section class="review-plan"><h2>间隔复习计划</h2>' +
        '<p class="study-muted">现在到期 '+overdue+' 词 · 下图显示未来 7 天已安排的复习，不含当前到期项。</p>' +
        '<div class="review-days">' + nextWeek.map((date, i) => '<div class="review-day" aria-label="'+esc(date)+'，'+counts[date]+' 词到期">' +
          '<strong>'+counts[date]+'</strong><span class="fill" aria-hidden="true"><i style="height:'+Math.round(counts[date]/max*100)+'%"></i></span>' +
          '<span>'+(i === 0 ? '今天' : date.slice(5).replace('-', '/'))+'</span></div>').join('') + '</div>' +
        '<p class="study-muted">没想起来：10 分钟后 · 模糊：12 小时后 · 到期时连续想起：1、3、7、15、30 天。</p></section>';
    }
    function renderProfile() {
      const host = $('#view-profile');
      if (host.hidden) return;
      const today = day.format(new Date());
      const now = Date.parse(today + 'T00:00:00Z');
      const first = now - (77 + ((new Date(now).getUTCDay() + 6) % 7)) * 86400000;
      const activity = local.activity || {};
      const grouped = new Map();
      for (const w of words()) {
        if (!grouped.has(w.chapter)) grouped.set(w.chapter, { known:0, fuzzy:0, new:0, due:0 });
        const summary = grouped.get(w.chapter);
        if (Object.hasOwn(ratings, w.rating)) summary[w.rating]++;
        if (w.dueAt <= Date.now() / 1000) summary.due++;
      }
      const total = ui.manifest.reduce((n,c)=>n+c.words,0);
      const known = [...grouped.values()].reduce((n,c)=>n+c.known,0);
      const seen = [...grouped.values()].reduce((n,c)=>n+c.known+c.fuzzy+c.new,0);
      const cells = [];
      for(let time=first; time < first+84*86400000; time+=86400000) {
        const date = new Date(time).toISOString().slice(0,10);
        const count = Number(activity[date] || 0);
        const level = count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 11 ? 3 : 4;
        const label = date + ' · ' + count + ' 次答题';
        cells.push(date > today ? '<span class="activity-cell is-future" aria-hidden="true"></span>'
          : '<button type="button" class="activity-cell" data-level="' + level + '" data-activity="' + esc(label) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"></button>');
      }
      host.innerHTML = '<header class="study-heading"><div class="kicker">LEARNING JOURNAL</div><h1>我的学习记录</h1>' +
        '<p>查看词汇掌握、复习活动和每篇故事的进度。</p></header>' +
        '<div class="profile-metrics">' +
        [['已学习',seen+' / '+total+' 词'],['已掌握',known+' 词'],['待听写',due().length+' 词'],['累计答题',Number(local.reviewCount || 0)+' 次']].map(([label,value]) =>
          '<div><span>'+label+'</span><strong>'+value+'</strong></div>').join('') + '</div>' +
        '<section class="activity-board"><header><h2>学习日历</h2><span>最近 12 周 · 北京时间</span></header>' +
          '<div class="activity-body"><span>一<br>二<br>三<br>四<br>五<br>六<br>日</span><div class="activity-grid">'+cells.join('')+'</div></div>' +
          '<footer><span id="activityHint" role="status">点选方格查看当天答题次数</span><span class="heat-legend">少 '+[0,1,2,3,4].map(n=>'<i data-level="'+n+'"></i>').join('')+' 多</span></footer></section>' +
        reviewPlan(now, words()) +
        '<section class="chapter-stats"><h2>逐篇掌握情况</h2><div class="chapter-stat-list">' +
        ui.manifest.map(c=>{
          const row = grouped.get(c.id) || {known:0,fuzzy:0,new:0,due:0};
          return '<article class="chapter-stat"><span class="chapter-stat-no">'+String(c.no).padStart(2,'0')+'</span>' +
            '<div><strong>'+esc(c.titleCn)+'</strong><span>'+row.known+' / '+c.words+' 已掌握 · '+row.fuzzy+' 模糊 · '+row.new+' 生疏 · '+Math.max(0,c.words-row.known-row.fuzzy-row.new)+' 未学习</span>' +
            '<div class="chapter-meter" aria-hidden="true">'+['known','fuzzy','new'].map(k=>'<i class="'+k+'" style="width:'+Math.min(100,row[k]*100/c.words)+'%"></i>').join('')+'</div></div>' +
            '<button class="btn" data-profile-chapter="'+esc(c.id)+'" aria-label="打开'+esc(c.titleCn)+'词表">词表 →</button></article>';
        }).join('')+'</div></section>';
    }
    function render() {
      const p = local.position || { chapter: 'ch01', paragraph: 'p1' };
      $('#continueDetail').textContent = label(p);
      $('#continueStudy').textContent = local.position ? '继续阅读' : '开始阅读';
      $('#continueStudy').disabled = Boolean(window.wordYarnDesktop && !tried);
      const count = due().length;
      $('#dueCount').textContent = count;
      $('#startDue').disabled = !count;
      $('#reviewSummary').textContent = snapshot
        ? '已答题 ' + snapshot.reviewCount + ' 次 · 到期复习中连续想起至少两次：' + snapshot.remembered + ' 词'
        : '每次先回忆，再核对原句和词义。';
      $('#studyConnection').textContent = connected
        ? (pending().length ? '正在保存学习记录…' : '已保存到 SQLite') :
        window.wordYarnDesktop && tried ? '无法连接本地数据库 · 请保留窗口并重试' :
        tried || !serverPossible ? '本地模式 · 学习记录暂存在此浏览器' : '正在连接学习服务…';
      $('#historyStudy').hidden = !connected;
      renderProfile();
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
          local.activity = remote.activity || local.activity;
          local.reviewCount = remote.reviewCount;
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
      if (closing || !chapter || !paragraph || (local.position?.chapter === chapter && local.position.paragraph === paragraph)) return;
      local.position = { chapter, paragraph };
      enqueue('position', local.position);
    }
    function rate(chapter, lemma, rating, review) {
      const payload = { chapter, lemma, rating };
      const now = Math.floor(Date.now() / 1000);
      if (review) {
        payload.attempt = id();
        payload.reviewedAt = now;
        const date = day.format(new Date());
        local.activity[date] = (local.activity[date] || 0) + 1;
        local.reviewCount = (local.reviewCount || 0) + 1;
      }
      const key = chapter + ':' + lemma;
      local.words[key] = { ...payload, ...estimate(local.words[key], rating, review, now) };
      enqueue(review ? 'review' : 'mark', payload);
      return local.words[key].dueAt;
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
      const version = ++exerciseVersion;
      item = null;
      panel.querySelector('.exercise-content').textContent = exerciseMode === 'dictation' ? '正在准备听写…' : '正在准备原句…';
      const w = queue.shift();
      if (!w) {
        panel.querySelector('.exercise-content').innerHTML = '<p>这组练习完成了。</p><button class="btn" data-study-close>完成</button>';
        return;
      }
      try {
        const ch = await ui.load(w.chapter);
        if (!panel.open || version !== exerciseVersion) return;
        const sentences = ch.paragraphs.flatMap(p => p.sentences);
        const vocab = ch.vocab.filter(v => v.lemma === w.lemma);
        const index = w.origin ?? vocab.find(v => v.origin != null)?.origin ??
          sentences.findIndex(s => s.words?.some(t => t.w === w.lemma));
        const sentence = sentences[index];
        const tokens = sentence?.words?.filter(t => t.w === w.lemma) || [];
        let prompt = sentence?.en || w.lemma;
        for (const t of tokens.slice().reverse())
          prompt = prompt.slice(0, t.at) + '____' + prompt.slice(t.at + t.len);
        const dictation = exerciseMode === 'dictation';
        const spoken = w.lemma.split('/')[0].replace(/\(([a-z]+)\)/gi, '');
        const answers = dictation ? [...new Set([w.lemma, spoken, w.lemma.replace(/[()]/g,'')].flatMap(x=>x.split('/')))] :
          [...new Set(tokens.map(t => sentence.en.slice(t.at, t.at + t.len)))];
        item = { ...w, answers, index, sentence, vocab, spoken };
        const chinese = vocab.find(v=>v.origin===index) || vocab[0];
        const cue = dictation
          ? '<p class="dictation-hint">' + esc(chinese?.def || '听发音，写下单词') + '</p><button class="btn" data-dictation-audio>重听单词</button>'
          : '<p class="exercise-sentence">' + esc(prompt) + '</p>' + (sentence?.cn ? '<p class="study-muted">' + esc(sentence.cn) + '</p>' : '');
        panel.querySelector('.exercise-content').innerHTML =
          '<p class="study-muted">' + esc(ch.titleCn) + ' · 本组还剩 ' + (queue.length + 1) + ' 词</p>' +
          cue +
          '<form id="exerciseForm"><label for="exerciseAnswer">' + (dictation ? '输入听到的英文单词' : answers.length ? '填入原句中的单词' : '先回忆词义') +
          '</label>' + (answers.length ? '<input id="exerciseAnswer" autocomplete="off" spellcheck="false">' : '') +
          '<button class="btn primary-study">核对答案</button></form>' +
          '<div id="exerciseReveal" hidden></div>';
        ($('#exerciseAnswer') || $('#exerciseForm button')).focus();
        if (dictation) ui.speak(spoken);
      } catch {
        if (!panel.open || version !== exerciseVersion) return;
        queue.unshift(w);
        panel.querySelector('.exercise-content').innerHTML = '<p>章节加载失败。</p><button class="btn" data-study-retry>重试</button>';
      }
    }
    function start(items, mode) {
      if (!items.length) return;
      exerciseMode = mode || 'context';
      $('#exerciseTitle').textContent = exerciseMode === 'dictation' ? '今日听写' : '原句练习';
      queue = items.slice(0, 10);
      const panel = $('#studyExercise');
      if (!panel.open) panel.showModal();
      next();
    }
    function answerPair(actual, options, matched) {
      const expected = matched || options[0] || '';
      const a = [...actual], b = [...expected];
      const matches = Array.from({length: a.length + 1}, () => new Uint16Array(b.length + 1));
      for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
          matches[i][j] = a[i].toLowerCase() === b[j].toLowerCase()
            ? 1 + matches[i + 1][j + 1] : Math.max(matches[i + 1][j], matches[i][j + 1]);
        }
      }
      const keepA = new Set(), keepB = new Set();
      for (let i = 0, j = 0; i < a.length && j < b.length;) {
        if (a[i].toLowerCase() === b[j].toLowerCase()) { keepA.add(i++); keepB.add(j++); }
        else if (matches[i + 1][j] >= matches[i][j + 1]) i++;
        else j++;
      }
      const paint = (chars, keep) => chars.map((c,i)=>keep.has(i) ? esc(c) : '<mark>'+esc(c)+'</mark>').join('');
      return '<div class="answer-compare"><div class="answer-yours"><span>你的拼写</span><strong>' +
        (actual ? paint(a, keepA) : '未填写') + '</strong></div><div class="answer-correct"><span>参考拼写</span><strong>' +
        paint(b, keepB) + '</strong></div></div>' +
        (options.length > 1 ? '<p class="study-muted">也接受：' + options.filter(x=>x!==expected).map(esc).join(' / ') + '</p>' : '');
    }
    function reveal() {
      if (!item) return;
      ui.stopSpeech();
      const answer = $('#exerciseAnswer')?.value.trim().slice(0, 128) || '';
      const match = item.answers.find(a => a.toLowerCase() === answer.toLowerCase());
      $('#exerciseForm').hidden = true;
      const panel = $('#exerciseReveal');
      panel.innerHTML = (item.answers.length ? '<p class="study-muted answer-result">' +
        (match ? '答对了' : answer ? '拼写不一致，看看标出的差别' : '这次未填写') + '</p>' +
        answerPair(answer, item.answers, match) : '') +
        '<p class="exercise-sentence">' + esc(item.sentence?.en || item.lemma) + '</p>' +
        '<p>' + esc(item.sentence?.cn || '') + '</p>' +
        '<p>' + item.vocab.map(v => esc(v.pos + ' ' + v.def)).join('；') + '</p>' +
        (item.index >= 0 ? '<button class="btn" data-study-origin="' + esc(item.chapter) + ':' + item.index + '">回到原句</button>' : '') +
        '<div class="study-actions">' + Object.entries(ratings).map(([id, label]) =>
          '<button class="btn" data-study-rate="' + id + '">' + label + '</button>').join('') + '</div>';
      panel.hidden = false;
      panel.querySelector(match ? '[data-study-rate=known]' : '[data-study-rate=new]').focus();
    }
    document.addEventListener('click', async function (e) {
      const t = e.target;
      if (t.closest('#continueStudy')) {
        const p = local.position || { chapter: 'ch01', paragraph: 'p1' };
        await ui.go(p.chapter, p.paragraph);
      } else if (t.closest('#startDue')) {
        if (syncing) await syncing;
        start(due(), 'dictation');
      } else if (t.closest('[data-dictation-audio]') && item) {
        ui.speak(item.spoken);
      } else if (t.closest('[data-activity]')) {
        $('#activityHint').textContent = t.closest('[data-activity]').dataset.activity;
      } else if (t.closest('[data-profile-chapter]')) {
        await ui.openVocab(t.closest('[data-profile-chapter]').dataset.profileChapter);
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
        const provisional = rate(w.chapter, w.lemma, rating, true);
        next();
        const receipt = $('#nextReviewReceipt');
        const printReceipt = (when, pendingText) => {
          receipt.hidden = false;
          receipt.textContent = w.lemma + ' · 下次复习 ' + timeLabel.format(new Date(when * 1000)) + pendingText;
        };
        const receiptVersion = exerciseVersion;
        printReceipt(provisional, '');
        const saved = sync();
        if (saved) saved.then(() => {
          if (exerciseVersion !== receiptVersion || !$('#studyExercise').open) return;
          const scheduled = local.words[w.chapter + ':' + w.lemma]?.dueAt || provisional;
          printReceipt(scheduled, connected ? '（已保存）' : '（本地安排）');
        });
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
    $('#studyExercise').addEventListener('close', () => {
      ++exerciseVersion; item = null; ui.stopSpeech(); $('#nextReviewReceipt').hidden = true;
    });
    document.addEventListener('submit', e => {
      if (e.target.id === 'exerciseForm') { e.preventDefault(); reveal(); }
      if (e.target.id === 'globalSearch') { e.preventDefault(); search(); }
    });
    $('#globalQuery').addEventListener('input', search);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); sync(); } });
    window.addEventListener('online', sync);
    if (window.wordYarnDesktop) {
      window.wordYarnFlush = async function () {
        // Freeze new input while the window is closing. The next scroll event
        // must not enqueue a different paragraph after the final write.
        closing = true;
        document.body.inert = true;
        try {
          await sync();
          if (pending().length) await sync();
          if (connected && !pending().length) return true;
        } catch {}
        window.wordYarnCancelClose();
        ui.toast('还有学习记录未写入数据库，请稍后再关闭');
        return false;
      };
      window.wordYarnCancelClose = function () {
        closing = false;
        document.body.inert = false;
      };
    }
    setInterval(() => { if (!document.hidden && (!$('#view-today').hidden || !$('#view-profile').hidden)) { render(); sync(); } }, 30000);
    render(); sync();
    return { position, rate, render, sync };
  };
})();
