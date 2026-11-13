#!/usr/bin/env node
/**
 * 归一化人工撰写内容里的中文标点，统一到第 1 章的规范：
 *   「」『』 → “ ”    （弯引号）
 *   破折号 ── → ——      （两个 U+2014）
 *   省略号 … → ……      （两个 U+2026）
 * 只改 content/*.sentences.json 与 *.vocab.json 里的中文串，英文例句不动。
 *   node tools/normalize_punct.mjs          干跑，只报告
 *   node tools/normalize_punct.mjs --write  真正写入
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const WRITE = process.argv.includes('--write');
// 可选：只处理指定章，例如 node tools/normalize_punct.mjs --write ch02 ch04
const only = process.argv.slice(2).filter((a) => /^ch\d+$/.test(a));

function fixCn(s) {
  if (typeof s !== 'string') return s;
  let t = s;
  // 直角引号 -> 弯引号（成对替换）
  t = t.replace(/「/g, '“').replace(/」/g, '”');
  t = t.replace(/『/g, '“').replace(/』/g, '”');
  // 破折号成对：奇数长度的连续串补一个
  t = t.replace(/—+/g, (m) => (m.length % 2 === 1 ? m + '—' : m));
  // 省略号不动：搭配提示里的「与…一致」是省略占位符，不是句末省略号
  return t;
}

let changed = 0, files = 0;
for (const f of fs.readdirSync(CONTENT)) {
  if (!/^ch\d+\.(sentences|vocab)\.json$/.test(f)) continue;
  const cid = f.match(/^(ch\d+)\./)[1];
  if (only.length && !only.includes(cid)) continue;
  const p = path.join(CONTENT, f);
  const raw = fs.readFileSync(p, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (e) { console.log(`跳过 ${f}: JSON 解析失败`); continue; }

  let n = 0;
  if (Array.isArray(data.sentences)) {
    data.sentences = data.sentences.map((s) => { const t = fixCn(s); if (t !== s) n++; return t; });
  }
  if (data.words) {
    for (const k of Object.keys(data.words)) {
      const w = data.words[k];
      if (w.ex) w.ex = w.ex.map((e) => {
        if (e.cn) { const t = fixCn(e.cn); if (t !== e.cn) n++; e.cn = t; }
        if (e.note) { const t = fixCn(e.note); if (t !== e.note) n++; e.note = t; }
        return e;
      });
    }
  }
  if (n) {
    files++; changed += n;
    console.log(`${WRITE ? '修正' : '待修正'} ${f}: ${n} 处`);
    if (WRITE) fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
}
console.log(`\n${WRITE ? '已写入' : '干跑'}：${files} 个文件，${changed} 处`);
