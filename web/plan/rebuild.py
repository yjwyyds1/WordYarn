# -*- coding: utf-8 -*-
"""Merge supplement words into the master word list, re-sort alphabetically, rebuild letter sections."""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "四级考纲词汇总表.md")
SUP = os.path.join(BASE, "plan", "supplement.txt")

with open(SRC, encoding="utf-8") as f:
    lines = f.read().split("\n")

# split header / word sections / appendix
header, sections, appendix = [], {}, []
cur = header
cur_letter = None
for ln in lines:
    if ln.startswith("## 附录"):
        appendix.append(ln)
        cur = appendix
        continue
    if cur is appendix:
        appendix.append(ln)
        continue
    if ln.startswith("## ") and len(ln) >= 4 and ln[3].isalpha():
        cur_letter = ln[3]
        sections.setdefault(cur_letter, []).append(ln)
        continue
    if cur_letter:
        sections[cur_letter].append(ln)
    else:
        header.append(ln)

# parse word rows from sections
rows = []  # (word, pos, meaning)
for L in sorted(sections):
    for ln in sections[L]:
        if not ln.startswith("| "):
            continue
        cells = [c.strip() for c in ln.strip("|").split("|")]
        if len(cells) != 3:
            continue
        w, p, m = cells
        if w in ("单词", "---") or set(w) <= {"-", " "}:
            continue
        rows.append((w, p, m))

# supplement rows
sup_rows = []
with open(SUP, encoding="utf-8") as f:
    for ln in f:
        ln = ln.strip()
        if not ln:
            continue
        cells = [c.strip() for c in ln.split("|")]
        if len(cells) != 3:
            print("BAD SUPP LINE:", ln)
            continue
        sup_rows.append(tuple(cells))

existing = {w for w, _, _ in rows}
new_words = [w for w, _, _ in sup_rows if w not in existing]
dup = [w for w, _, _ in sup_rows if w in existing]
print("supplement rows:", len(sup_rows), "new words:", len(new_words), "dups:", dup)

all_rows = rows + [r for r in sup_rows if r[0] not in existing]

# stable sort by lowercase word; keep multi-POS rows of same word adjacent in original order
key = {}
def sort_key(row):
    w = row[0].lower()
    return w

all_rows.sort(key=sort_key)
print("total words:", len({w for w, _, _ in all_rows}), "total rows:", len(all_rows))

# group by letter
groups = {}
for w, p, m in all_rows:
    L = w.strip().upper()[0]
    if not L.isalpha():
        L = "#"
    groups.setdefault(L, []).append((w, p, m))

out = header[:]
for L in sorted(groups):
    out.append("## %s" % L)
    out.append("")
    out.append("| 单词 | 词性 | 释义 |")
    out.append("| --- | --- | --- |")
    for w, p, m in groups[L]:
        out.append("| %s | %s | %s |" % (w, p, m))
    out.append("")
out.extend(appendix)

with open(SRC, "w", encoding="utf-8") as f:
    f.write("\n".join(out).rstrip("\n") + "\n")
print("rebuilt:", SRC)
