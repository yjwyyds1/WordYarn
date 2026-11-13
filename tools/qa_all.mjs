#!/usr/bin/env node
/**
 * 全库质检：找出译文里漏掉的专有名词、没转换的引号、可能的漏译等问题。
 *   node tools/qa_all.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapter } from './split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');
const CONTENT = path.join(ROOT, 'content');

const ALLOW = new Set([
  // 允许保留的外文（技术/专有名词/品牌）
  'USB', 'ID', 'BCE', 'X-ray', 'Fahrenheit', 'Sentinel', 'Shelf',
]);

const out = [];
let issues = 0;

for (const f of fs.readdirSync(SRC).filter((x) => /^Chapter_\d+.*\.md$/.test(x)).sort()) {
  const no = Number(f.match(/Chapter_(\d+)/)[1]);
  const id = 'ch' + String(no).padStart(2, '0');
  const sFile = path.join(CONTENT, `${id}.sentences.json`);
  if (!fs.existsSync(sFile)) continue;
  const c = parseChapter(fs.readFileSync(path.join(SRC, f), 'utf8'));
  const flat = [];
  c.paragraphs.forEach((p) => p.sentences.forEach((s) => flat.push(s)));
  const sent = JSON.parse(fs.readFileSync(sFile, 'utf8')).sentences;

  sent.forEach((cn, i) => {
    const en = flat[i] || '';
    const prob = [];
    // 1) 残留的西文专名
    const latin = cn.match(/[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*/g) || [];
    const bad = latin.filter((w) => {
      const head = w.split(/\s+/)[0];
      return /^[A-Z]/.test(head) && !ALLOW.has(head) && !/^(I|OK|PC)$/.test(head);
    });
    if (bad.length) prob.push('残留外文: ' + [...new Set(bad)].join(' / '));
    // 2) 直角引号
    if (/[「」『』]/.test(cn)) prob.push('直角引号未转换');
    // 3) 疑似漏译（中文里几乎没有汉字）
    const han = (cn.match(/[\u4e00-\u9fff]/g) || []).length;
    if (han < 4) prob.push(`汉字过少(${han}): ${cn.slice(0, 40)}`);
    // 4) 译文与原文完全一样
    if (cn.trim() === en.trim()) prob.push('译文与原文相同');
    // 5) 译文里有半角逗号/句号
    if (/[a-zA-Z\u4e00-\u9fff],/.test(cn) || /[a-zA-Z\u4e00-\u9fff]\./.test(cn)) prob.push('中文里混用半角标点');
    // 6) 译文过短
    if (cn.length < 4) prob.push('译文过短');

    if (prob.length) {
      issues++;
      out.push(`${id} 第 ${i + 1} 句: ${prob.join(' | ')}`);
      out.push(`    EN ${en.slice(0, 110)}`);
      out.push(`    CN ${cn.slice(0, 110)}`);
    }
  });
}

fs.writeFileSync(path.join(CONTENT, '_qa.txt'), out.join('\n'), 'utf8');
console.log(`问题 ${issues} 处 -> content/_qa.txt`);
if (out.length) console.log(out.slice(0, 30).join('\n'));
