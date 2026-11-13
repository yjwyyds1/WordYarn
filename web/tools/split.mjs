#!/usr/bin/env node
/**
 * 从 Markdown 源文件抽取「标题 / 元信息 / 段落 / 句子 / 目标词表」。
 * 供 build_site_data.mjs 复用，也可单独跑来看切分结果。
 *
 * 用法: node tools/split.mjs "词汇故事集/Chapter_01_The-Arrival.md"
 */
import fs from 'node:fs';
import path from 'node:path';

/** 称谓/缩写后不能断句：Mr. / Mrs. / Ms. / Dr. / Prof. / St. / Jr. / Sr. / vs. 等 */
const ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|Inc|Ltd|Co)\.$/i;

/** 切句：英文句末标点后接大写/引号时切；再按引号奇偶把被拆开的引语重新合并。 */
export function splitSentences(text) {
  const raw = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=["“(\[]?[A-Z0-9])/);

  // 缩写结尾的碎片要和下一段合并（"Ms. Chen said" 不能断成两句）
  const merged = [];
  for (let i = 0; i < raw.length; i++) {
    let seg = raw[i];
    while (i + 1 < raw.length && ABBR.test(seg.trim())) seg += ' ' + raw[++i];
    merged.push(seg);
  }

  const out = [];
  let cur = '';
  let parity = 0;
  for (const seg of merged) {
    cur = cur ? cur + ' ' + seg : seg;
    parity = (parity + (seg.match(/"/g) || []).length) % 2;
    if (parity === 0) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 解析一个章节 Markdown。 */
export function parseChapter(md) {
  const lines = md.split(/\r?\n/);
  const chapters = { title: '', titleCn: '', meta: {}, body: [], vocab: [], tips: [] };

  let section = null; // 'body' | 'vocab' | 'tips'
  let tableHeader = true;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('# ')) {
      const m = line.slice(2).match(/^([\s\S]*?)\s*[\u00B7\u2022|]\s*([\s\S]+)$/);
      if (m) {
        // "Chapter 01 · The Arrival 初到海州" -> 英文标题 + 中文标题
        const cm = m[2].match(/^([\s\S]*?)\s+([\u4e00-\u9fff][\s\S]*)$/);
        chapters.title = cm ? cm[1].trim() : m[2].trim();
        chapters.titleCn = cm ? cm[2].trim() : '';
      } else {
        const cm = line.slice(2).match(/^([\s\S]*?)\s+([\u4e00-\u9fff][\s\S]*)$/);
        chapters.title = cm ? cm[1].trim() : line.slice(2).trim();
        chapters.titleCn = cm ? cm[2].trim() : '';
      }
      continue;
    }
    if (line.startsWith('## ')) {
      const h = line.slice(3).trim();
      if (/词汇|目标词/.test(h)) section = 'vocab';
      else if (/复习|自测/.test(h)) section = 'tips';
      else section = 'body';
      tableHeader = true;
      continue;
    }
    if (line === '---') { section = null; continue; }

    // 头部 blockquote 元信息（无论当前 section）
    if (line.startsWith('>')) {
      const t = line.replace(/^>\s*/, '');
      for (const mm of t.matchAll(/\*\*(.+?)\*\*：(.+?)(?=\s*·\s*\*\*|$)/g)) {
        chapters.meta[mm[1]] = mm[2].trim();
      }
      continue;
    }

    if (section === 'vocab' && line.startsWith('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length);
      if (tableHeader) { tableHeader = false; continue; }
      if (cells.length >= 3 && !/^-+$/.test(cells[0])) chapters.vocab.push({ w: cells[0], pos: cells[1], def: cells[2] });
      continue;
    }
    if (section === 'tips' && /^[-*]\s+/.test(line)) {
      chapters.tips.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }
    if (section === 'body' && line.startsWith('>')) {
      const t = line.replace(/^>\s*/, '');
      const mm = t.match(/^\*\*(.+?)\*\*：(.+)$/);
      if (mm) chapters.meta[mm[1]] = mm[2].trim();
      continue;
    }
    if (section === 'body' || section === null) {
      if (/^[>*-]/.test(line) || line.startsWith('|')) continue;
      chapters.body.push(line);
    }
  }

  chapters.paragraphs = chapters.body.map((p) => ({ en: p, sentences: splitSentences(p) }));
  return chapters;
}

if (process.argv[1] && process.argv[1].endsWith('split.mjs')) {
  const file = process.argv[2];
  const md = fs.readFileSync(file, 'utf8');
  const c = parseChapter(md);
  console.log(JSON.stringify(c, null, 2));
  console.error(`\n段落 ${c.paragraphs.length} / 句子 ${c.paragraphs.reduce((n, p) => n + p.sentences.length, 0)} / 词条 ${c.vocab.length}`);
}
