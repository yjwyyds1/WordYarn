#!/usr/bin/env node
/** 打印切分结果，便于人工核对。 node tools/dump.mjs <md> [out.txt] */
import fs from 'node:fs';
import { parseChapter } from './split.mjs';

const c = parseChapter(fs.readFileSync(process.argv[2], 'utf8'));
let out = [];
const w = (s = '') => out.push(s);
w('META: ' + JSON.stringify(c.meta, null, 2));
w('TITLE: ' + c.title + ' | ' + c.titleCn);
let n = 0;
c.paragraphs.forEach((p, pi) => {
  w(`\n=== P${pi + 1}  (${p.sentences.length} 句) ===`);
  p.sentences.forEach((s) => { n++; w(`[${String(n).padStart(2, '0')}] ${s}`); });
});
w(`\n段落 ${c.paragraphs.length} / 句子 ${n} / 词条 ${c.vocab.length} / 去重词 ${new Set(c.vocab.map(v => v.w.toLowerCase())).size}`);
w('TIPS: ' + JSON.stringify(c.tips, null, 2));
const text = out.join('\n');
if (process.argv[3]) { fs.writeFileSync(process.argv[3], text, 'utf8'); console.error('written -> ' + process.argv[3]); }
else process.stdout.write(text);
