#!/usr/bin/env node
/**
 * 统一专有名词音译。子代理可能漏译人名（如把 Sarah 留成 Sarah），
 * 这里按全站统一的口径批量改写：David→大卫、Mark→马克、Sarah→萨拉 …
 * 只改 content/*.json 里的中文串，英文例句不动。
 *   node tools/normalize_names.mjs          干跑
 *   node tools/normalize_names.mjs --write  写入
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const WRITE = process.argv.includes('--write');
// 可选：只处理指定章
const only = process.argv.slice(2).filter((a) => /^ch\d+$/.test(a));

// 长的在前，先替换
const MAP = [
  // 所有格
  ["Xiao Lin's", '小林的'], ["Xiao Chen's", '小陈的'], ["Xiao Han's", '小韩的'],
  ["David's", '大卫的'], ["Mark's", '马克的'], ["Sarah's", '萨拉的'],
  ["Tao's", '陶的'], ["Liu's", '刘的'], ["Wang's", '王的'], ["Wu's", '吴的'],
  ["Zhou's", '周的'], ["Li's", '李的'], ["Chen's", '陈的'], ["Lin's", '林的'], ["Han's", '韩的'],
  // 机构 / 地名 / 节日
  ['Haizhou University', '海州大学'], ['Haizhou Museum', '海州博物馆'],
  ['Professor Chen', '陈教授'], ['Doctor Zhou', '周医生'],
  ['Ms Li', '李女士'], ['Ms Chen', '陈女士'], ['Ms Wang', '王女士'], ['Ms Lin', '林女士'],
  ['Ms Liu', '刘女士'], ['Ms Han', '韩女士'], ['Ms Wu', '吴女士'], ['Ms Tao', '陶女士'], ['Ms Zhou', '周女士'],
  ['Xiao Chen', '小陈'], ['Xiao Lin', '小林'], ['Xiao Han', '小韩'],
  ['Lin Mei', '林梅'], ['Lin Yuan', '林远'],
  ['The Sentinel', '哨兵报'], ['English Club', '英语俱乐部'], ['Campus Life', '校园生活'],
  ['Model Parliament', '模拟议会'], ['Green Volunteers', '绿色志愿者'],
  ['Spring Festival', '春节'], ["New Year's Eve", '除夕'], ['Christmas', '圣诞节'],
  ['Fahrenheit', '华氏'], ['Haizhou', '海州'],
  // 人名
  ['David', '大卫'], ['Mark', '马克'], ['Sarah', '萨拉'],
  ['Lin', '林'], ['Han', '韩'], ['Li', '李'], ['Tao', '陶'],
  ['Zhou', '周'], ['Liu', '刘'], ['Wu', '吴'], ['Wang', '王'], ['Chen', '陈'],
  ['Ms', '女士'],
  // 产品名
  ['Shelf', '书架'],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fixCn(s) {
  if (typeof s !== 'string') return s;
  let t = s;
  for (const [en, cn] of MAP) {
    if (!t.includes(en)) continue;
    t = t.replace(new RegExp('(?<![A-Za-z])' + esc(en) + '(?![A-Za-z])', 'g'), cn);
  }
  return t;
}

let changed = 0, files = 0;
const detail = [];
for (const f of fs.readdirSync(CONTENT)) {
  if (!/^ch\d+\.(sentences|vocab)\.json$/.test(f)) continue;
  const cid = f.match(/^(ch\d+)\./)[1];
  if (only.length && !only.includes(cid)) continue;
  const p = path.join(CONTENT, f);
  let data;
  try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.log('跳过 ' + f); continue; }
  let n = 0;
  if (Array.isArray(data.sentences)) {
    data.sentences = data.sentences.map((s) => {
      const t = fixCn(s);
      if (t !== s) { n++; detail.push(`${f} 句: ${s}  ->  ${t}`); }
      return t;
    });
  }
  if (data.words) {
    for (const k of Object.keys(data.words)) {
      const w = data.words[k];
      if (w.ex) w.ex = w.ex.map((e) => {
        if (e.cn) { const t = fixCn(e.cn); if (t !== e.cn) { n++; detail.push(`${f} 词条 ${k}: ${e.cn}  ->  ${t}`); } e.cn = t; }
        if (e.note) { const t = fixCn(e.note); if (t !== e.note) { n++; detail.push(`${f} note ${k}: ${e.note}  ->  ${t}`); } e.note = t; }
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
fs.writeFileSync(path.join(CONTENT, '_name_fixes.txt'), detail.join('\n'), 'utf8');
console.log(`\n${WRITE ? '已写入' : '干跑'}：${files} 个文件，${changed} 处；明细 -> content/_name_fixes.txt`);
