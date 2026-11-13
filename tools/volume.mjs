#!/usr/bin/env node
/** 统计全部章节的体量：段落 / 句子 / 词条 / 去重词。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapter } from './split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');

const files = fs.readdirSync(SRC).filter((f) => /^Chapter_\d+.*\.md$/.test(f)).sort();
let tS = 0, tE = 0, tW = 0;
const rows = [];
for (const f of files) {
  const no = Number(f.match(/Chapter_(\d+)/)[1]);
  const c = parseChapter(fs.readFileSync(path.join(SRC, f), 'utf8'));
  const sen = c.paragraphs.reduce((n, p) => n + p.sentences.length, 0);
  const lem = new Set(c.vocab.map((v) => v.w.toLowerCase()));
  tS += sen; tE += c.vocab.length; tW += lem.size;
  rows.push(`ch${String(no).padStart(2, '0')}  ${c.title} / ${c.titleCn}  段${String(c.paragraphs.length).padStart(2)} 句${String(sen).padStart(3)} 词条${String(c.vocab.length).padStart(3)} 去重词${String(lem.size).padStart(3)}`);
}
const out = rows.join('\n') + `\n\n合计: 句子 ${tS} / 词条 ${tE} / 去重词 ${tW}\n`;
fs.writeFileSync(path.join(ROOT, 'content', '_volume.txt'), out, 'utf8');
console.log(`句子 ${tS} / 词条 ${tE} / 去重词 ${tW}`);
console.log(out);
