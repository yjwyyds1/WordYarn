# -*- coding: utf-8 -*-
"""Check that every target word of a chapter appears in its story (with common inflections allowed)."""
import os, re, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(BASE, "plan")
RAW = os.path.join(BASE, "chapters", "raw")

N = int(sys.argv[1])
chunk_path = os.path.join(PLAN, "chunk_%02d.txt" % N)
story_path = os.path.join(RAW, "chapter_%02d_story.md" % N)

with open(chunk_path, encoding="utf-8") as f:
    lines = [ln.rstrip("\n") for ln in f if ln.strip()]
words = []
for ln in lines:
    w = ln.split("|")[0].strip()
    if w and w not in words:
        words.append(w)

story = open(story_path, encoding="utf-8").read().lower()
story_plain = re.sub(r"[^a-z0-9' -]", " ", story)  # keep letters, spaces, hyphens for phrase matching

def variants(w):
    w = w.strip().lower()
    parts = [p.strip() for p in w.split("/") if p.strip()]
    out = set()
    for p in parts:
        if "(s)" in p:
            out.add(p.replace("(s)", ""))
            out.add(p.replace("(s)", "s"))
            continue
        if " " in p or "-" in p or "." in p:
            out.add(p)  # literal phrase
            continue
        base = p
        vs = {base, base + "s", base + "es", base + "d", base + "ed", base + "ing"}
        if base.endswith("e") and len(base) > 2:
            vs |= {base[:-1] + "ed", base[:-1] + "ing", base[:-1] + "es", base[:-1] + "d"}
        if base.endswith("y") and len(base) > 2:
            vs |= {base[:-1] + "ies", base[:-1] + "ied"}
        if len(base) > 2 and base[-1] in "bdfgmnprt" and base[-2] in "aeiou":
            vs |= {base + base[-1] + "ed", base + base[-1] + "ing"}
        out |= vs
    return out

missing = []
for w in words:
    found = False
    for v in variants(w):
        if " " in v or "-" in v or "." in v:
            if v in story_plain:
                found = True
                break
        else:
            if re.search(r"(?<![a-z])%s(?![a-z])" % re.escape(v), story_plain):
                found = True
                break
    if not found:
        missing.append(w)

report = os.path.join(PLAN, "missing_%02d.txt" % N)
with open(report, "w", encoding="utf-8") as f:
    f.write("\n".join(missing) + ("\n" if missing else ""))
print("chapter %02d: %d/%d words found, %d missing" % (N, len(words) - len(missing), len(words), len(missing)))
if missing:
    print("MISSING:", ", ".join(missing))
