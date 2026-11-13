#!/usr/bin/env node
/**
 * 为每一章生成撰写简报 content/_briefs/chNN.md。
 * 简报里固定了：全局句号编号（译文数组按此顺序）、词表行号（ex 数组按此行序）。
 * 这样 29 个并行子任务解析口径完全一致，不会串位。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapter } from './split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '词汇故事集');
const OUT = path.join(ROOT, 'content', '_briefs');

const STYLE = `
## 写作规范（务必照做，全 30 章保持一致）

### 逐句译文
- 一句英文对一句中文，数组顺序 = 下面「逐句译文」里的编号顺序，**不能增删、不能换位**。
- 忠实、自然、文学化的中文；不要逐词硬译，句子要读得通。
- **人名地名一律音译，和第 1 章保持一致**：
  David→大卫，Mark→马克，Sarah→萨拉，Haizhou→海州，Haizhou University→海州大学，
  Lin Yuan（主角本名）→林远，Xiao Han→小韩，其它专有名词同理（拿不准就音译）。
  院校/机构名可保留英文（University of Chicago 等），但**人名必须音译**。
- **中文引号用弯引号 “ ”**（不要用「」或『』），破折号用 ——（两个 U+2014）。
- 数字/时间按中文习惯写：「七点十分」「九月第一个星期日」「四楼」「两个人」。
- 口语对白照原样译成引号里的中文；引号外的大段叙述用正常标点。
- 长句可以在语义转折处断成两句，但**不能改变句子数量**（一句话仍然对应数组里的一个元素）。
- 不要加解释、不要加括号注释、不要在译文里补充原文没有的信息。

### 词汇例句
- 每个词条一行，\`.w\` 的 \`ex\` 数组长度 = 该词在词表里的**行数**（一个词性一行）。
  例：\`accord\` 在词表里占了 2 行（n. 和 v.），那 \`ex\` 就要 2 个例句，第 1 个对应 n.，第 2 个对应 v.。
- \`ipa\`：给出音标，格式 \`/ˈwɜːd/\`，用国际音标，重音用 ˈ 或 ˌ，卷舌用 ː，长音用 ː，美音英音都行但要准确。
- 例句要**贴着该词性那个义项**写，不要一个例子糊弄所有词性。
- 例句是**可迁移的通用句**（不是照抄正文原句），CET4 难度，能体现这个词的典型用法。
- \`cn\` 是例句的中文翻译，要地道。
- \`note\` 可选：写用法提示或搭配（如 \`abandon oneself to 沉溺于\`、\`in accord with 与…一致\`）。没有特别值得写的就省略这个键。
- 例句里该词本身可以用别的形态（abandoned、abandoning、abandons 都行）。

### 产出格式
只写两个文件，不要改别的：
1. \`content/chNN.sentences.json\`：\`{ "sentences": [ "...", ... ] }\`
2. \`content/chNN.vocab.json\`：\`{ "words": { "word": { "ipa": "/.../", "ex": [ { "en": "...", "cn": "...", "note": "..." } ] } } }\`

- \`words\` 的键是**小写单词**；词表里写成 \`a/b\` 形式的就照抄（如 \`exam/examination\`、\`defense/defence\`）。
- 词表里同一个词出现多行时，只在 \`words\` 里出现**一次**，它的 \`ex\` 数组按行序放多个例句。
- JSON 用 UTF-8，不要有注释、不要有尾逗号。
- 写完必须自己校验：JSON 能 parse、sentences 数组长度 = 句子数、每个词的 ex 数量 = 它的词表行数。
`;

fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(SRC).filter((f) => /^Chapter_\d+.*\.md$/.test(f)).sort();
const index = [];

for (const f of files) {
  const no = Number(f.match(/Chapter_(\d+)/)[1]);
  const id = 'ch' + String(no).padStart(2, '0');
  const c = parseChapter(fs.readFileSync(path.join(SRC, f), 'utf8'));

  const senLines = [];
  let n = 0;
  c.paragraphs.forEach((p, pi) => {
    senLines.push(`\n### 第 ${pi + 1} 段（${p.sentences.length} 句）`);
    p.sentences.forEach((s) => { n++; senLines.push(`${n}. ${s}`); });
  });

  const wordLines = c.vocab.map((v, i) => `${i + 1}. ${v.w} | ${v.pos} | ${v.def}`);

  const md = `# ${c.title} · ${c.titleCn}

- 章节号: ${id}
- 主题: ${c.meta['主题'] || ''}
- 段落数: ${c.paragraphs.length}　句子数: ${n}　词条行数: ${c.vocab.length}　去重词: ${new Set(c.vocab.map((v) => v.w.toLowerCase())).size}

> 英文正文见 \`词汇故事集/${f}\`。

## 一、逐句译文（按编号顺序，数组元素与编号一一对应）
${senLines.join('\n')}

## 二、词表（按行号顺序；ex 数组按该词的行序）
${wordLines.join('\n')}
${STYLE}`;

  fs.writeFileSync(path.join(OUT, `${id}.md`), md, 'utf8');
  index.push(`${id}.md  ${c.title} / ${c.titleCn}  句${n} 词条${c.vocab.length}`);
}

fs.writeFileSync(path.join(OUT, '_index.txt'), index.join('\n') + '\n', 'utf8');
console.log(`生成 ${files.length} 份简报 -> ${OUT}`);
