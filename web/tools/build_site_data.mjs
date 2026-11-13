#!/usr/bin/env node
/**
 * 构建站点数据。
 *
 * 输入:  词汇故事集/Chapter_NN_*.md   (源, 含正文 + 目标词表)
 *        content/chNN.sentences.json    (可选, 人工撰写的逐句译文)
 *        content/chNN.vocab.json        (可选, 人工撰写的音标与例句)
 * 输出:  site/data/chNN.js             (window.CHAPTER_DATA.push({...}))
 *        site/data/chapters.js         (章节清单)
 *
 * 用法: node tools/build_site_data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapter } from './split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');
const CONTENT = path.join(ROOT, 'content');
const OUT = path.join(ROOT, 'site', 'data');

/** 词形变体（移植自 plan/check.py，保证与原项目校验口径一致）。 */
function variants(w) {
  const out = new Set();
  for (const p of w.trim().toLowerCase().split('/').map((s) => s.trim()).filter(Boolean)) {
    if (/[ .\-]/.test(p)) { out.add(p); continue; }
    const vs = new Set([p, p + 's', p + 'es', p + 'd', p + 'ed', p + 'ing']);
    if (p.endsWith('e') && p.length > 2) {
      vs.add(p.slice(0, -1) + 'ed'); vs.add(p.slice(0, -1) + 'ing');
      vs.add(p.slice(0, -1) + 'es'); vs.add(p.slice(0, -1) + 'd');
    }
    if (p.endsWith('y') && p.length > 2) {
      vs.add(p.slice(0, -1) + 'ies'); vs.add(p.slice(0, -1) + 'ied');
    }
    if (p.length > 2 && 'bdfgmnprt'.includes(p.at(-1)) && 'aeiou'.includes(p.at(-2))) {
      vs.add(p + p.at(-1) + 'ed'); vs.add(p + p.at(-1) + 'ing');
    }
    vs.forEach((v) => out.add(v));
  }
  return [...out];
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 在句子里找某个词（含词形变体）的所有候选匹配位置。 */
function findMatches(sentence, w) {
  const out = [];
  for (const v of variants(w).sort((a, b) => b.length - a.length)) {
    if (/[ .\-]/.test(v)) {
      const re = new RegExp(esc(v), 'gi');
      let m;
      while ((m = re.exec(sentence)) !== null) out.push({ at: m.index, len: m[0].length });
      continue;
    }
    const re = new RegExp(`(?<![A-Za-z])${esc(v)}(?![A-Za-z])`, 'gi');
    let m;
    while ((m = re.exec(sentence)) !== null) out.push({ at: m.index, len: m[0].length });
  }
  return out;
}

/** 贪心取不重叠的最长匹配。 */
function bestMatches(sentence, w) {
  const cands = findMatches(sentence, w).sort((a, b) => (b.len - a.len) || (a.at - b.at));
  const taken = [];
  for (const c of cands) {
    if (taken.some((t) => c.at < t.at + t.len && t.at < c.at + c.len)) continue;
    taken.push(c);
  }
  return taken.sort((a, b) => a.at - b.at);
}

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(SRC).filter((f) => /^Chapter_\d+.*\.md$/.test(f)).sort();
const manifest = [];
let report = [];

for (const file of files) {
  const no = Number(file.match(/Chapter_(\d+)/)[1]);
  const id = 'ch' + String(no).padStart(2, '0');
  const md = fs.readFileSync(path.join(SRC, file), 'utf8');
  const parsed = parseChapter(md);

  const sentFile = path.join(CONTENT, `${id}.sentences.json`);
  const vocabFile = path.join(CONTENT, `${id}.vocab.json`);
  const sentData = readJson(sentFile);
  const vocabData = readJson(vocabFile);

  // ---- 句子 ----
  const flat = [];
  parsed.paragraphs.forEach((p, pi) => p.sentences.forEach((en, si) => flat.push({ pi, si, en })));

  let cn = [];
  if (sentData?.sentences) {
    cn = sentData.sentences;
    if (cn.length !== flat.length) {
      console.error(`✗ ${id} 译文条数不匹配: 译文 ${cn.length} / 正文 ${flat.length}`);
      process.exitCode = 1;
    }
  }
  const translated = cn.length === flat.length && cn.every((x) => typeof x === 'string' && x.length);

  // ---- 目标词表 ----
  const extra = vocabData?.words || {};
  // 人工数据用原始大小写做键也能匹配
  const extraByLemma = new Map(Object.keys(extra).map((k) => [k.toLowerCase(), extra[k]]));
  const lemmas = new Map(); // lemma -> [rowIdx]
  parsed.vocab.forEach((v, i) => {
    const key = v.w.toLowerCase();
    if (!lemmas.has(key)) lemmas.set(key, []);
    lemmas.get(key).push(i);
  });

  // 词 -> 原文例句（同一词的多个词性行按出现顺序分配不同句子）
  const hits = new Map(); // lemma -> [sentenceGlobalIndex]
  for (const [lemma] of lemmas) {
    const list = [];
    flat.forEach((s, gi) => { if (bestMatches(s.en, lemma).length) list.push(gi); });
    hits.set(lemma, list);
  }

  const vocab = parsed.vocab.map((v, i) => {
    const lemma = v.w.toLowerCase();
    const rows = lemmas.get(lemma);
    const slot = rows.indexOf(i);
    const list = hits.get(lemma) || [];
    // 一个词若在正文里只出现 N 次，最多只能给 N 个词性行配到不同的原文句
    const hasOwn = list.length > slot;
    const originGi = hasOwn ? list[slot] : -1;
    const e = extraByLemma.get(lemma);
    const exArr = e?.ex || [];
    const ex = exArr[slot] || exArr[0] || null;
    return {
      w: v.w,
      pos: v.pos,
      def: v.def,
      lemma,
      ipa: e?.ipa || '',
      ex: ex ? { en: ex.en, cn: ex.cn, note: ex.note || '' } : null,
      origin: originGi >= 0 ? originGi : null,
      occurrences: list.length,
      sameWord: rows.length > 1,
    };
  });

  const missing = [...lemmas.keys()].filter((l) => !(hits.get(l) || []).length);
  const noEx = vocab.filter((v) => !v.ex).map((v) => v.w);

  // ---- 组装 ----
  const paragraphs = parsed.paragraphs.map((p, pi) => ({
    id: `p${pi + 1}`,
    sentences: p.sentences.map((en, si) => {
      const gi = flat.findIndex((s) => s.pi === pi && s.si === si);
      // 句中命中的目标词：跨词去重叠，长词优先
      const cands = [];
      for (const [lemma] of lemmas) {
        for (const m of bestMatches(en, lemma)) cands.push({ ...m, w: lemma });
      }
      cands.sort((a, b) => (b.len - a.len) || (a.at - b.at));
      const taken = [];
      for (const c of cands) {
        if (taken.some((t) => c.at < t.at + t.len && t.at < c.at + c.len)) continue;
        taken.push(c);
      }
      taken.sort((a, b) => a.at - b.at);
      return {
        en,
        cn: translated ? cn[gi] : '',
        words: taken.map((c) => ({ w: c.w, at: c.at, len: c.len })),
      };
    }),
  }));

  const data = {
    id,
    no,
    title: parsed.title,
    titleCn: parsed.titleCn,
    theme: parsed.meta['主题'] || '',
    meta: parsed.meta,
    tips: parsed.tips,
    stats: {
      paragraphs: paragraphs.length,
      sentences: flat.length,
      entries: vocab.length,
      words: lemmas.size,
    },
    translated,
    paragraphs,
    vocab,
  };

  const js = `/* 自动生成，请勿手改。源: ${file} | 改内容请改 词汇故事集/ 与 content/ 后重新运行 tools/build_site_data.mjs */\n`
    + `window.CHAPTER_DATA = window.CHAPTER_DATA || [];\n`
    + `window.CHAPTER_DATA.push(${JSON.stringify(data)});\n`;
  fs.writeFileSync(path.join(OUT, `${id}.js`), js, 'utf8');

  manifest.push({
    id, no,
    title: parsed.title,
    titleCn: parsed.titleCn,
    theme: parsed.meta['主题'] || '',
    words: lemmas.size,
    sentences: flat.length,
    paragraphs: paragraphs.length,
    translated,
  });

  report.push(`${id}  ${parsed.title} / ${parsed.titleCn}  段落${paragraphs.length} 句${flat.length} 词${lemmas.size} 译文${translated ? '有' : '缺'}`
    + (missing.length ? `  ⚠正文未出现: ${missing.join(',')}` : '')
    + (noEx.length ? `  ⚠缺例句: ${noEx.join(',')}` : ''));
}

fs.writeFileSync(path.join(OUT, 'chapters.js'),
  `/* 自动生成。章节清单。 */\nwindow.CHAPTER_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`, 'utf8');

fs.writeFileSync(path.join(OUT, 'chapters.js.map'),
  manifest.map((m) => `${m.id}\t${m.no}\t${m.title}\t${m.titleCn}`).join('\n') + '\n', 'utf8');

console.log(report.join('\n'));
console.log(`\n共 ${manifest.length} 章 -> ${OUT}`);
