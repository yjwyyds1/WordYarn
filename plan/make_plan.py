# -*- coding: utf-8 -*-
"""Parse the master CET-4 word list and split it round-robin into 18 chapter chunks."""
import os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "四级考纲词汇总表.md")
PLAN = os.path.join(BASE, "plan")
os.makedirs(PLAN, exist_ok=True)

N_CH = 30

rows = []  # (word, pos, meaning)
seen_words = set()
bad = []
in_appendix = False
with open(SRC, encoding="utf-8") as f:
    for ln, line in enumerate(f, 1):
        line = line.rstrip("\n")
        if line.startswith("## 附录"):
            in_appendix = True
        if in_appendix:
            continue
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) >= 3 and cells[0] not in ("单词", "---") and not set(cells[0]) <= {"-", " "}:
            word, pos, meaning = cells[0], cells[1], cells[2]
            rows.append((word, pos, meaning))
            seen_words.add(word)
        elif len(cells) != 0 and cells[0] not in ("单词", "---"):
            bad.append((ln, line))

if bad:
    print("BAD ROWS:")
    for ln, line in bad[:20]:
        print(ln, line)
    sys.exit(1)

words = []
word_rows = {}  # word -> list of rows
for w, p, m in rows:
    if w not in word_rows:
        word_rows[w] = []
        words.append(w)
    word_rows[w].append((w, p, m))

print("total unique words:", len(words))
print("total rows:", len(rows))
print("first:", words[0], "| last:", words[-1])

# round-robin
chunks = [[] for _ in range(N_CH)]
for i, w in enumerate(words):
    chunks[i % N_CH].append(w)

sizes = [len(c) for c in chunks]
print("chunk sizes:", sizes, "sum:", sum(sizes))

for ci, chunk in enumerate(chunks, 1):
    with open(os.path.join(PLAN, "chunk_%02d.txt" % ci), "w", encoding="utf-8") as f:
        for w in chunk:
            for (_, p, m) in word_rows[w]:
                f.write("%s | %s | %s\n" % (w, p, m))
print("chunks written to", PLAN)
