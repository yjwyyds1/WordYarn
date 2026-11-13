# -*- coding: utf-8 -*-
"""Add a '所在篇目' column to the master word list based on the chapter word map."""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "四级考纲词汇总表.md")
MAP = os.path.join(BASE, "plan", "word_map.txt")

word_ch = {}
with open(MAP, encoding="utf-8") as f:
    for ln in f:
        ln = ln.strip()
        if not ln:
            continue
        w, ch = [x.strip() for x in ln.split("|")]
        word_ch[w] = int(ch)

with open(SRC, encoding="utf-8") as f:
    lines = f.read().split("\n")

out = []
in_appendix = False
found = 0
missing = []
for ln in lines:
    if ln.startswith("## 附录"):
        in_appendix = True
        out.append(ln)
        continue
    if in_appendix:
        out.append(ln)
        continue
    if ln.startswith("| ") and not ln.startswith("| ---") and not ln.startswith("| 单词"):
        cells = [c.strip() for c in ln.strip("|").split("|")]
        # keep only the first three cells; drop any existing chapter-ref column
        cells = cells[:3]
        if len(cells) == 3:
            w, p, m = cells
            ch = word_ch.get(w)
            if ch is not None:
                out.append("| %s | %s | %s | 第 %d 篇 |" % (w, p, m, ch))
                found += 1
            else:
                out.append(ln)
                missing.append(w)
            continue
        out.append(ln)
        continue
    if ln.startswith("| 单词"):
        out.append("| 单词 | 词性 | 释义 | 所在篇目 |")
        continue
    if ln.startswith("| ---"):
        out.append("| --- | --- | --- | --- |")
        continue
    out.append(ln)

print("rows with chapter refs:", found)
print("rows without refs:", len(missing))
if missing:
    print("MISSING:", missing[:30])

with open(SRC, "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print("updated master list")
