# -*- coding: utf-8 -*-
"""Check each chapter's style: word count, paragraph count, stray markdown formatting."""
import os, re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "chapters", "raw")

problems = 0
print("%-4s %6s %4s %6s %s" % ("ch", "words", "para", "maxpar", "issues"))
for n in range(1, 31):
    p = os.path.join(RAW, "chapter_%02d_story.md" % n)
    if not os.path.exists(p):
        print("%-4d MISSING FILE" % n)
        problems += 1
        continue
    text = open(p, encoding="utf-8").read().strip()
    words = len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text))
    paras = [x.strip() for x in re.split(r"\n\s*\n", text) if x.strip()]
    counts = [len(re.findall(r"[A-Za-z]+", x)) for x in paras]
    issues = []
    if not (1350 <= words <= 1650):
        issues.append("length")
    if len(paras) < 7:
        issues.append("few-paragraphs")
    if max(counts) > 260:
        issues.append("long-paragraph")
    if "*" in text:
        issues.append("asterisk")
    if re.search(r"^\s*#", text, re.M):
        issues.append("heading")
    if re.search(r"\bin the telling\b", text):
        issues.append("journal-phrase")
    if issues:
        problems += 1
    print("%-4d %6d %4d %6d %s" % (n, words, len(paras), max(counts), ",".join(issues) or "ok"))

print("\nchapters with issues:", problems)
