#!/usr/bin/env node
/** 查专有名词在原文里的上下文，确认音译映射。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');
const NAMES = ['Lin', 'Li', 'Han', 'Tao', 'Zhou', 'Liu', 'Wu', 'Wang', 'Shelf', 'Ms', 'Chen', 'Xiao'];

const out = [];
for (const n of NAMES) {
  const hits = [];
  for (const f of fs.readdirSync(SRC).filter((x) => /^Chapter_\d+.*\.md$/.test(x))) {
    const t = fs.readFileSync(path.join(SRC, f), 'utf8');
    const m = t.match(new RegExp('[^.]*\\b' + n + '\\b[^.]*', 'g')) || [];
    m.forEach((x) => { if (hits.length < 4) hits.push(x.trim().slice(0, 100)); });
  }
  out.push(`### ${n}  (${hits.length ? '' : '未出现'})`);
  hits.forEach((h) => out.push('   ' + h));
  out.push('');
}
fs.writeFileSync(path.join(ROOT, 'content', '_name_ctx.txt'), out.join('\n'), 'utf8');
console.log('-> content/_name_ctx.txt');
