#!/usr/bin/env node
/** 打印待重译的句子及其上下文，供人工翻译。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const todo = JSON.parse(fs.readFileSync(path.join(CONTENT, '_refix.json'), 'utf8'));

const out = [];
for (const id of Object.keys(todo)) {
  const c = JSON.parse(fs.readFileSync(path.join(CONTENT, `${id}.sentences.json`), 'utf8')).sentences;
  out.push(`\n########## ${id}  (${todo[id].length} 句)`);
  for (const n of todo[id]) {
    out.push('');
    out.push(`[${n.index + 1}] 被吸收的碎片: ${n.absorbed.map((a) => '"' + a + '"').join(' + ')}`);
    out.push(`EN  ${n.en}`);
    const prev = n.index > 0 ? c[n.index - 1] : '';
    const next = c[n.index + 1] || '';
    out.push(`上句译文: ${prev}`);
    out.push(`下句译文: ${next}`);
    out.push(`CN  ⟪待填⟫`);
  }
}
fs.writeFileSync(path.join(CONTENT, '_refix_detail.txt'), out.join('\n'), 'utf8');
console.log('-> content/_refix_detail.txt');
