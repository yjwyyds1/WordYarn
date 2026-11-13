#!/usr/bin/env node
/**
 * 缩写合并后的译文重对齐。
 *
 * 旧切句会把 "Ms. Chen said" 拆成两句，新切句合成一句。
 * 于是旧译文数组里有一项是碎片（"Ms."），新句子则需要一整句新译文。
 *
 * 做法：
 *   1. 把新旧句子做通用对齐（判断新句是不是几句旧句的拼接）
 *   2. 未变化的句子直接沿用旧译文
 *   3. 合并出来的句子列为「待补」，输出到 content/_refix.json
 *
 *   node tools/realign.mjs           只报告
 *   node tools/realign.mjs --write   把复用结果写回 content/chNN.sentences.json（待补项留空）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapter } from './split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');
const CONTENT = path.join(ROOT, 'content');
const WRITE = process.argv.includes('--write');

/** 旧版（带缩写 bug）切句 */
function oldSplit(text) {
  const raw = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=["“(\[]?[A-Z0-9])/);
  const out = []; let cur = ''; let parity = 0;
  for (const seg of raw) {
    cur = cur ? cur + ' ' + seg : seg;
    parity = (parity + (seg.match(/"/g) || []).length) % 2;
    if (parity === 0) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 取正文段落（和 parseChapter 一致的口径） */
function bodyParas(md) {
  const lines = md.split(/\r?\n/).map((l) => l.trim());
  const out = []; let inBody = false;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('# ')) continue;
    if (line.startsWith('## ')) { inBody = !/词汇|目标词|复习/.test(line); continue; }
    if (line === '---') { inBody = false; continue; }
    if (line.startsWith('>')) continue;
    if (line.startsWith('|')) continue;
    if (inBody) out.push(line);
  }
  return out;
}

const report = [];
const todo = {};   // { chNN: [ {index, en, absorbed:[...]} ] }
let totalTodo = 0;

for (const f of fs.readdirSync(SRC).filter((x) => /^Chapter_\d+.*\.md$/.test(x)).sort()) {
  const no = Number(f.match(/Chapter_(\d+)/)[1]);
  const id = 'ch' + String(no).padStart(2, '0');
  const sFile = path.join(CONTENT, `${id}.sentences.json`);
  if (!fs.existsSync(sFile)) continue;

  const md = fs.readFileSync(path.join(SRC, f), 'utf8');
  const c = parseChapter(md);
  const newFlat = [];
  c.paragraphs.forEach((p) => p.sentences.forEach((s) => newFlat.push(s)));
  const oldFlat = [];
  bodyParas(md).forEach((p) => oldSplit(p).forEach((s) => oldFlat.push(s)));

  if (oldFlat.length === newFlat.length) continue;

  const oldCn = JSON.parse(fs.readFileSync(sFile, 'utf8')).sentences;

  // 通用对齐：new[ni] 由 old[oi..oi+k-1] 拼接而成
  const newCn = [];
  const need = [];
  let oi = 0;
  for (let ni = 0; ni < newFlat.length; ni++) {
    let acc = '';
    let k = 0;
    while (oi + k < oldFlat.length) {
      const cand = acc ? acc + ' ' + oldFlat[oi + k] : oldFlat[oi + k];
      if (newFlat[ni] === cand) { k++; break; }
      if (!newFlat[ni].startsWith(cand)) { k = 0; break; }
      acc = cand; k++;
      if (cand === newFlat[ni]) break;
    }
    if (k === 0) {
      // 兜底：单句相同
      if (oldFlat[oi] === newFlat[ni]) k = 1;
      else { newCn.push(''); need.push({ index: ni, en: newFlat[ni], absorbed: [], reason: '无法对齐' }); oi++; continue; }
    }
    if (k === 1) {
      newCn.push(oldCn[oi] || '');
    } else {
      newCn.push('');
      need.push({ index: ni, en: newFlat[ni], absorbed: oldFlat.slice(oi, oi + k) });
    }
    oi += k;
  }

  totalTodo += need.length;
  report.push(`${id}  旧 ${oldFlat.length} → 新 ${newFlat.length} 句；需重译 ${need.length} 句`);
  need.forEach((n) => report.push(`   · 第 ${n.index + 1} 句：${n.en}`));
  todo[id] = need;

  if (WRITE) {
    fs.writeFileSync(sFile, JSON.stringify({ sentences: newCn }, null, 2) + '\n', 'utf8');
  }
}

fs.writeFileSync(path.join(CONTENT, '_refix.json'), JSON.stringify(todo, null, 2), 'utf8');
fs.writeFileSync(path.join(CONTENT, '_refix.txt'), report.join('\n'), 'utf8');
console.log(`需重译 ${totalTodo} 句，涉及 ${Object.keys(todo).length} 章`);
console.log(report.slice(0, 20).join('\n'));
