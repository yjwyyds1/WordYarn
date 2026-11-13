#!/usr/bin/env node
/**
 * 抽检人工撰写的内容：随机看几句译文的忠实度、几个词条的例句质量。
 *   node tools/spotcheck.mjs ch07 8          随机 8 句
 *   node tools/spotcheck.mjs ch07 8 --words 5 顺带看 5 个词条
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapter } from './split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');
const CONTENT = path.join(ROOT, 'content');

const id = process.argv[2] || 'ch02';
const n = Number(process.argv[3] || 8);
const wantWords = process.argv.includes('--words');
const nWords = Number(process.argv[process.argv.indexOf('--words') + 1] || 5);
const outFile = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(process.env.TEMP || '.', `spot_${id}.txt`);

const file = fs.readdirSync(SRC).find((f) => f.startsWith('Chapter_' + id.slice(2)));
if (!file) { console.error('找不到章节文件: ' + id); process.exit(1); }
const c = parseChapter(fs.readFileSync(path.join(SRC, file), 'utf8'));
const flat = [];
c.paragraphs.forEach((p) => p.sentences.forEach((s) => flat.push(s)));

const sent = JSON.parse(fs.readFileSync(path.join(CONTENT, `${id}.sentences.json`), 'utf8')).sentences;
const voc = JSON.parse(fs.readFileSync(path.join(CONTENT, `${id}.vocab.json`), 'utf8')).words;

let seed = 20241021;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const idxs = [];
while (idxs.length < Math.min(n, flat.length)) {
  const i = Math.floor(rnd() * flat.length);
  if (!idxs.includes(i)) idxs.push(i);
}

const out = [];
const w = (s = '') => out.push(s);

w(`\n===== ${id}  ${c.title} / ${c.titleCn}  句子抽检 =====\n`);
idxs.sort((a, b) => a - b).forEach((i) => {
  w(`[${i + 1}] EN  ${flat[i]}`);
  w(`     CN  ${sent[i] || '（缺）'}`);
  w('');
});

if (wantWords) {
  const keys = Object.keys(voc);
  const ws = [];
  while (ws.length < Math.min(nWords, keys.length)) {
    const k = keys[Math.floor(rnd() * keys.length)];
    if (!ws.includes(k)) ws.push(k);
  }
  w(`===== 词条抽检 =====\n`);
  ws.forEach((k) => {
    const word = voc[k];
    w(`${k}  ${word.ipa}`);
    (word.ex || []).forEach((e, i) => {
      w(`  ex[${i}] ${e.en}`);
      w(`        ${e.cn}${e.note ? '   〔' + e.note + '〕' : ''}`);
    });
    w('');
  });
}

fs.writeFileSync(outFile, out.join('\n'), 'utf8');
console.log('written -> ' + outFile);
