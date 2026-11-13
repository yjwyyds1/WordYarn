#!/usr/bin/env node
/** 扫出正文里出现的人名地名机构名（排除句首大写），供音译对照表使用。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapter } from './split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');

const COMMON = new Set(['The', 'A', 'An', 'He', 'She', 'It', 'They', 'We', 'I', 'You', 'But', 'And', 'So',
  'Then', 'There', 'This', 'That', 'These', 'Those', 'When', 'Where', 'What', 'Which', 'Who', 'Why',
  'His', 'Her', 'Its', 'Their', 'My', 'Your', 'Our', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'English', 'Chinese', 'Chinese', 'American', 'London', 'Beijing',
  'Shanghai', 'Shenzhen', 'Guangzhou', 'Hangzhou', 'Nanjing', 'Xian', 'Chengdu', 'Wuhan', 'Tianjin',
  'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Half', 'Every', 'Another', 'Each', 'Both', 'Not',
  'Now', 'Yes', 'No', 'Perhaps', 'Maybe', 'After', 'Before', 'Since', 'Until', 'While', 'Because',
  'For', 'From', 'With', 'Without', 'About', 'Around', 'Down', 'Up', 'Out', 'Over', 'Under', 'Again',
  'At', 'By', 'In', 'Of', 'On', 'To', 'As', 'If', 'So', 'Or', 'Nor', 'Yet', 'Just', 'Only', 'Even',
  'Still', 'Almost', 'Enough', 'Perhaps', 'Indeed', 'Instead', 'However', 'Therefore', 'Thus',
  'Meanwhile', 'Finally', 'Suddenly', 'Quietly', 'Slowly', 'Warmly', 'Politely', 'Hardly', 'Likely',
  'Certainly', 'Probably', 'Naturally', 'Usually', 'Generally', 'Recently', 'Originally', 'Originally',
  'Mr', 'Mrs', 'Miss', 'Dr', 'Professor', 'Uncle', 'Aunt']);

const count = new Map();
for (const f of fs.readdirSync(SRC).filter((x) => /^Chapter_\d+.*\.md$/.test(x))) {
  const c = parseChapter(fs.readFileSync(path.join(SRC, f), 'utf8'));
  const flat = [];
  c.paragraphs.forEach((p) => p.sentences.forEach((s) => flat.push(s)));
  flat.forEach((s) => {
    // 去掉句首第一个词，避免把普通句首词当专名
    const m = s.match(/^["“]?([A-Z][a-zA-Z'’-]+)/);
    const skip = m ? m[1] : null;
    const words = s.match(/\b[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)*/g) || [];
    for (let w of words) {
      if (w === skip) continue;
      if (COMMON.has(w)) continue;
      count.set(w, (count.get(w) || 0) + 1);
    }
  });
}

const rows = [...count.entries()].sort((a, b) => b[1] - a[1]);
const out = rows.map(([w, n]) => `${String(n).padStart(4)}  ${w}`).join('\n');
fs.writeFileSync(path.join(ROOT, 'content', '_names.txt'), out + '\n', 'utf8');
console.log(rows.slice(0, 60).map(([w, n]) => `${String(n).padStart(4)}  ${w}`).join('\n'));
console.log(`\n共 ${rows.length} 个候选 -> content/_names.txt`);
