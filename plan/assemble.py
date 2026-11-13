# -*- coding: utf-8 -*-
"""Assemble final chapter markdown files: title header + story + target word table."""
import os, re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(BASE, "plan")
RAW = os.path.join(BASE, "chapters", "raw")
OUT = os.path.join(BASE, "词汇故事集")
os.makedirs(OUT, exist_ok=True)

titles = {}
with open(os.path.join(PLAN, "titles.txt"), encoding="utf-8") as f:
    for ln in f:
        ln = ln.strip()
        if not ln:
            continue
        parts = [p.strip() for p in ln.split("|")]
        titles[parts[0]] = (parts[1], parts[2], parts[3])

word_map = {}  # word -> chapter
for n in range(1, 31):
    nn = "%02d" % n
    en, cn, theme = titles[nn]
    story = open(os.path.join(RAW, "chapter_%s_story.md" % nn), encoding="utf-8").read().strip()

    rows = []
    with open(os.path.join(PLAN, "chunk_%s.txt" % nn), encoding="utf-8") as f:
        for ln in f:
            ln = ln.rstrip("\n")
            if not ln.strip():
                continue
            cells = [c.strip() for c in ln.split("|")]
            if len(cells) == 3:
                rows.append((cells[0], cells[1], cells[2]))
                if cells[0] not in word_map:
                    word_map[cells[0]] = n

    n_words = len({r[0] for r in rows})
    n_english = len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", story))

    out = []
    out.append("# Chapter %s · %s %s" % (nn, en, cn))
    out.append("")
    out.append("> **主题**：%s" % theme)
    out.append("> **本篇目标词**：%d 个 · **正文篇幅**：约 %d 词" % (n_words, n_english))
    out.append("> **阅读建议**：① 先通读全文，结合上下文猜测生词含义；② 对照文末词汇表核对；③ 遮住释义回忆词义；④ 隔天重读一遍，一周后再复习一次。")
    out.append("")
    out.append("## 正文")
    out.append("")
    out.append(story)
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 本篇目标词（%d 词）" % n_words)
    out.append("")
    out.append("| 单词 | 词性 | 释义 |")
    out.append("| --- | --- | --- |")
    for w, p, m in rows:
        out.append("| %s | %s | %s |" % (w, p, m))
    out.append("")
    out.append("## 复习自测")
    out.append("")
    out.append("- 盖住右列，看着英文回忆中文；再盖住左列，看着中文回忆英文。")
    out.append("- 重读正文，找出本篇目标词并说出其含义。")
    out.append("- 3 天后复习一次，7 天后再复习一次，然后进入下一篇。")
    out.append("")

    path = os.path.join(OUT, "Chapter_%s_%s.md" % (nn, en.replace(" ", "-").replace(":", "-")))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print("wrote", os.path.basename(path), "| %d words | %d english words" % (n_words, n_english))

# word map for master list reference
with open(os.path.join(PLAN, "word_map.txt"), "w", encoding="utf-8") as f:
    for w in sorted(word_map, key=lambda x: x.lower()):
        f.write("%s | %d\n" % (w, word_map[w]))
print("word_map entries:", len(word_map))
