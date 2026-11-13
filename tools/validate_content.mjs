#!/usr/bin/env node
/**
 * 校验 content/ 下人工撰写的内容是否与正文严格对齐。
 *   node tools/validate_content.mjs           校验全部
 *   node tools/validate_content.mjs ch02 ch03 只校验指定章
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapter } from './split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');
const CONTENT = path.join(ROOT, 'content');

const args = process.argv.slice(2);
const files = fs.readdirSync(SRC).filter((f) => /^Chapter_\d+.*\.md$/.test(f)).sort()
  .filter((f) => !args.length || args.includes('ch' + String(Number(f.match(/Chapter_(\d+)/)[1])).padStart(2, '0')));

/* 例句里出现该词：允许常见词形变化 */
const IRREG = {
  give: 'gave given giving', speak: 'spoke spoken speaking', say: 'said saying',
  take: 'took taken taking', make: 'made making', go: 'went gone going',
  get: 'got gotten getting', do: 'did done doing', be: 'am is are was were been being',
  have: 'has had having', see: 'saw seen seeing', come: 'came coming',
  know: 'knew known knowing', think: 'thought thinking', tell: 'told telling',
  sell: 'sold selling', buy: 'bought buying', bring: 'brought bringing',
  teach: 'taught teaching', catch: 'caught catching', drive: 'drove driven driving',
  ride: 'rode ridden riding', write: 'wrote written writing', grow: 'grew grown growing',
  begin: 'began begun beginning', run: 'ran running', swim: 'swam swimming',
  fly: 'flew flown flying', throw: 'threw thrown throwing', find: 'found finding',
  lose: 'lost losing', pay: 'paid paying', lead: 'led leading', build: 'built building',
  spend: 'spent spending', stand: 'stood standing', understand: 'understood understanding',
  feel: 'felt feeling', keep: 'kept keeping', sleep: 'slept sleeping', meet: 'met meeting',
  leave: 'left leaving', win: 'won winning', put: 'put putting', cut: 'cut cutting',
  let: 'let letting', set: 'set setting', man: 'men', woman: 'women', child: 'children',
  foot: 'feet', tooth: 'teeth', person: 'people', life: 'lives', knife: 'knives',
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function appears(en, lemma) {
  const l = lemma.split('/')[0].toLowerCase();
  if (new RegExp('\\b' + esc(l) + '\\w*', 'i').test(en)) return true;
  if (IRREG[l] && IRREG[l].split(' ').some((f) => new RegExp('\\b' + f + '\\b', 'i').test(en))) return true;
  // 规则变化：丢掉结尾 1-2 个字母当词干（classif→classified / fisherm→fishermen / remed→remedied）
  for (const cut of [1, 2, 3]) {
    if (l.length - cut >= 4) {
      const core = l.slice(0, l.length - cut);
      if (new RegExp('\\b' + esc(core) + '\\w*', 'i').test(en)) return true;
    }
  }
  return false;
}

let errs = 0, warn = 0, done = 0, missing = 0;

for (const f of files) {
  const no = Number(f.match(/Chapter_(\d+)/)[1]);
  const id = 'ch' + String(no).padStart(2, '0');
  const c = parseChapter(fs.readFileSync(path.join(SRC, f), 'utf8'));
  const nSen = c.paragraphs.reduce((n, p) => n + p.sentences.length, 0);

  const sFile = path.join(CONTENT, `${id}.sentences.json`);
  const vFile = path.join(CONTENT, `${id}.vocab.json`);
  if (!fs.existsSync(sFile) || !fs.existsSync(vFile)) { missing++; console.log(`○ ${id} 未撰写`); continue; }

  const E = [];
  let sent = null, voc = null;
  try { sent = JSON.parse(fs.readFileSync(sFile, 'utf8')); } catch (e) { E.push('sentences.json 解析失败: ' + e.message); }
  try { voc = JSON.parse(fs.readFileSync(vFile, 'utf8')); } catch (e) { E.push('vocab.json 解析失败: ' + e.message); }
  if (!sent || !voc) { errs += E.length; E.forEach((x) => console.log(`✗ ${id} ${x}`)); continue; }

  // 译文
  const arr = sent.sentences;
  if (!Array.isArray(arr)) E.push('sentences 不是数组');
  else {
    if (arr.length !== nSen) E.push(`译文条数 ${arr.length} ≠ 正文句数 ${nSen}`);
    arr.forEach((s, i) => {
      if (typeof s !== 'string' || !s.trim()) E.push(`第 ${i + 1} 句译文为空`);
      else if (s.length < 2) E.push(`第 ${i + 1} 句译文过短: "${s}"`);
      else if (s.length > 220) E.push(`第 ${i + 1} 句译文过长(${s.length}字)`);
    });
  }

  // 词表
  const words = voc.words || {};
  const rowCount = new Map();
  c.vocab.forEach((v) => {
    const k = v.w.toLowerCase();
    rowCount.set(k, (rowCount.get(k) || 0) + 1);
  });
  const keyMap = new Map(Object.keys(words).map((k) => [k.toLowerCase(), k]));
  for (const [lemma, rows] of rowCount) {
    if (!keyMap.has(lemma)) { E.push(`缺词条: ${lemma}`); continue; }
    const w = words[keyMap.get(lemma)];
    if (!w.ipa || !/^\/.+\/$/.test(w.ipa)) E.push(`${lemma} 音标格式不对: ${w.ipa}`);
    if (!Array.isArray(w.ex)) { E.push(`${lemma} 缺 ex 数组`); continue; }
    if (w.ex.length !== rows) E.push(`${lemma} ex 数量 ${w.ex.length} ≠ 词表行数 ${rows}`);
    w.ex.forEach((e, i) => {
      if (!e || !e.en || !e.en.trim()) E.push(`${lemma} ex[${i}] 缺英文`);
      if (!e || !e.cn || !e.cn.trim()) E.push(`${lemma} ex[${i}] 缺中文`);
      if (e && e.en && !appears(e.en, lemma))
        E.push(`${lemma} ex[${i}] 英文里没有出现该词: ${e.en}`);
    });
  }
  const extra = Object.keys(words).filter((k) => !rowCount.has(k.toLowerCase()));
  if (extra.length) E.push(`多余词条: ${extra.join(', ')}`);

  if (E.length) { errs += E.length; console.log(`✗ ${id}  ${E.length} 个问题`); E.slice(0, 6).forEach((x) => console.log('   · ' + x)); }
  else { done++; console.log(`✓ ${id}  ${nSen} 句 / ${rowCount.size} 词 全部通过`); }
}

console.log(`\n通过 ${done} 章，有问题 ${errs} 处，未撰写 ${missing} 章`);
if (errs) process.exitCode = 1;
