#!/usr/bin/env node
/**
 * 对比「旧切分」与「修好缩写后」的新切分，列出受影响的章和句子，
 * 并为每处生成需要补写的译文提示。
 *   node tools/refix_abbrev.mjs          只报告
 *   node tools/refix_abbrev.mjs --write   把新句子落盘到 content/_refix.json（待补译文）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapter } from './split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');
const CONTENT = path.join(ROOT, 'content');
const ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|Inc|Ltd|Co)\.$/i;

/** 旧版切分（带缩写 bug），用于对比 */
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

const out = [];
const fixes = {};   // { chNN: { index: {en, cn: ''} } }
let totalCh = 0, totalSen = 0;

for (const f of fs.readdirSync(SRC).filter((x) => /^Chapter_\d+.*\.md$/.test(x)).sort()) {
  const no = Number(f.match(/Chapter_(\d+)/)[1]);
  const id = 'ch' + String(no).padStart(2, '0');
  const md = fs.readFileSync(path.join(SRC, f), 'utf8');
  const c = parseChapter(md);

  const oldFlat = [];
  c.paragraphs.forEach((p) => p.sentences.forEach((s) => oldFlat.push(s)));

  // 新旧对比
  const newFlat = [];
  c.paragraphs.forEach((p) => p.sentences.forEach((s) => newFlat.push(s)));

  // 用旧算法重建一遍（同一份 md，但旧切句）
  const oldC = { paragraphs: [] };
  // 手工重建：直接对每段正文用 oldSplit
  const bodyParas = md.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[#>|*\-]/.test(l) && !/^>/.test(l) && !/^\|/.test(l));
  const oldList = [];
  bodyParas.forEach((p) => oldSplit(p).forEach((s) => oldList.push(s)));

  if (oldList.length === newFlat.length) continue;
  totalCh++; totalSen += oldList.length - newFlat.length;

  // 逐句对齐：找出被合并的
  const need = [];
  let oi = 0, ni = 0;
  while (oi < oldList.length && ni < newFlat.length) {
    if (oldList[oi] === newFlat[ni]) { oi++; ni++; continue; }
    if (oldList[oi + 1] === newFlat[ni]) {
      // old[oi] 是被吸收的缩写碎片
      need.push({ newIndex: ni, en: newFlat[ni], absorbed: oldList[oi] });
      oi += 2; ni++;
      continue;
    }
    oi++; ni++;
  }
  out.push(`\n${id}  旧 ${oldList.length} 句 → 新 ${newFlat.length} 句（合并 ${need.length} 处）`);
  need.forEach((n) => out.push(`   · 新第 ${n.newIndex + 1} 句需重译：${n.en}`));
  fixes[id] = need.map((n) => ({ index: n.newIndex, en: n.en, absorbed: n.absorbed, cn: '' }));
}

fs.writeFileSync(path.join(CONTENT, '_refix.json'), JSON.stringify(fixes, null, 2), 'utf8');
fs.writeFileSync(path.join(CONTENT, '_refix.txt'), out.join('\n'), 'utf8');
console.log(`受影响 ${totalCh} 章，共减少 ${totalSen} 句`);
console.log(out.join('\n'));
