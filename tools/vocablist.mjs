#!/usr/bin/env node
/** 打印词表清单（去重词 + 多词性行），供人工撰写音标与例句时对齐。 */
import fs from 'node:fs';
import { parseChapter } from './split.mjs';

const c = parseChapter(fs.readFileSync(process.argv[2], 'utf8'));
const seen = new Map();
c.vocab.forEach((v, i) => {
  const k = v.w.toLowerCase();
  if (!seen.has(k)) seen.set(k, []);
  seen.get(k).push(v.pos);
});
const out = [];
out.push('总词条 ' + c.vocab.length + ' / 去重词 ' + seen.size);
out.push('');
let n = 0;
for (const [w, poss] of seen) {
  n++;
  out.push(`${String(n).padStart(3, ' ')}. ${w}  [${poss.join(' | ')}]`);
}
const text = out.join('\n');
if (process.argv[3]) { fs.writeFileSync(process.argv[3], text, 'utf8'); console.error('written -> ' + process.argv[3]); }
else process.stdout.write(text);
