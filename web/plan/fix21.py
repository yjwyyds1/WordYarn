# -*- coding: utf-8 -*-
"""Fix ungrammatical "The + adjective + of" constructions in chapter 21."""
import io, sys
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "chapters" / "raw" / "chapter_21_story.md"
with io.open(path, "r", encoding="utf-8") as f:
    text = f.read()

pairs = [
    ("*The artistic of the fake page, in the telling, was the scam's one skill, and the class showed the seams.*",
     "*The fake page's artistic skill, in the telling, was the scam's one craft, and the class showed the seams.*"),
    ("*The boring of the class's middle hour, in the telling, was the most important part, and the room stayed.*",
     "*The class's middle hour was boring, in the telling, and it was the most important part, and the room stayed.*"),
    ("*The competent of the class, in the telling, was the speaker, and the room trusted the calm.*",
     "*The class's speaker was competent, in the telling, and the room trusted the calm.*"),
    ("*The concrete of the class's rules, in the telling, was three: check, call, and wait.*",
     "*The concrete form of the class's rules, in the telling, was three: check, call, and wait.*"),
    ("*The dangerous of the scam, in the telling, was its patience, and the class taught the defense.*",
     "*The scam was dangerous, in the telling, in its patience, and the class taught the defense.*"),
    ("*The durable of the class's lesson, in the telling, was the habit, and the habit would hold.*",
     "*The class's lesson was durable, in the telling, and the habit would hold.*"),
    ("*The elementary of the class, in the telling, was the alphabet of the safe click, and the room learned it.*",
     "*The elementary part of the class, in the telling, was the alphabet of the safe click, and the room learned it.*"),
    ("*The caution, in the telling, was everywhere by Friday, and the everywhere was the point.*",
     "*The caution, in the telling, was everywhere by Friday, and everywhere was the point.*"),
    ("*The extreme of the scam's promises, in the telling, was the tell, and the class taught the eye.*",
     "*The extreme promises of the scam, in the telling, were the tell, and the class taught the eye.*"),
    ("*The far of the scam's origin, in the telling, was the overseas server, and the distance was the lesson.*",
     "*The scam's far origin, in the telling, was the overseas server, and the distance was the lesson.*"),
    ("*The financial of the class's advice, in the telling, was the one rule: no money to strangers.*",
     "*The financial advice of the class, in the telling, was the one rule: no money to strangers.*"),
    ("*The frequent of the class's questions, in the telling, was the room's, and the speaker answered all.*",
     "*The class's questions were frequent, in the telling, and the speaker answered all.*"),
    ("*The genuine of the class's tone, in the telling, was the speaker's, and the room trusted it.*",
     "*The class's tone was genuine, in the telling, and the room trusted it.*"),
    ("*The good of the class, in the telling, was the habit, and the habit was the whole of it.*",
     "*The good part of the class, in the telling, was the habit, and the habit was the whole of it.*"),
    ("*The harsh of the class's warnings, in the telling, was softened by the speaker's calm.*",
     "*The class's warnings were harsh, in the telling, and the speaker's calm softened them.*"),
    ("*The historical of the scam's tricks, in the telling, was the speaker's subject, and the subject was rich.*",
     "*The historical side of the scam's tricks, in the telling, was the speaker's subject, and the subject was rich.*"),
    ("*The hot of the hall, in the telling, was the June's, and the fans turned through the class.*",
     "*The hall was hot, in the telling, and the fans turned through the class.*"),
    ("*The identical of the fake page, in the telling, was almost perfect, and the almost was the lesson.*",
     "*The identical look of the fake page, in the telling, was almost perfect, and the almost was the lesson.*"),
    ("*The industrial of the scam, the speaker said, was the scale, and the defense was the habit.*",
     "*The industrial scale of the scam, the speaker said, was the trick, and the defense was the habit.*"),
    ("*The outward of the class's lesson, in the telling, was the habit, and the inward was the calm.*",
     "*The outward form of the class's lesson, in the telling, was the habit, and the inward was the calm.*"),
    ("*The pale of the scam's victims, in the telling, was the class's first slide, and the room was silent.*",
     "*The pale faces of the scam's victims, in the telling, were the class's first slide, and the room was silent.*"),
    ("*The possibly of the next scam, in the telling, was certain, and the class was the preparation.*",
     "*The next scam would possibly come, in the telling, and the class was the preparation.*"),
    ("*The proper of the class's habits, in the telling, was the speaker's gift to the campus.*",
     "*The proper habits of the class, in the telling, were the speaker's gift to the campus.*"),
    ("*The real of the class's lesson, in the telling, was the habit, and the habit was learned.*",
     "*The real lesson of the class, in the telling, was the habit, and the habit was learned.*"),
    ("*The reliable of the class's rules, in the telling, was proven by the week's own story.*",
     "*The class's rules were reliable, in the telling, and the week's own story proved them.*"),
    ("*The soft of the speaker's voice, in the telling, was the class's true weapon.*",
     "*The soft tone of the speaker's voice, in the telling, was the class's true weapon.*"),
    ("*The tough of the class's lesson, in the telling, was the habit, and the habit was the strength.*",
     "*The class's lesson was tough, in the telling, and the habit was the strength.*"),
    ("*The class, in the telling, undertook the campus's caution, and the caution was the term's.*",
     "*The class, in the telling, would undertake the campus's caution, and the caution was the term's.*"),
    ("*The urgent of the class's first rule, in the telling, was the speaker's one emphasis: never hurry.*",
     "*The class's first rule was urgent, in the telling, and the speaker's one emphasis was: never hurry.*"),
    ("*The wholly of the class's lesson, in the telling, was the habit, and the habit was whole.*",
     "*The wholly practical lesson of the class, in the telling, was the habit, and the habit was whole.*"),
]

missing = []
for old, new in pairs:
    if old in text:
        text = text.replace(old, new)
    else:
        missing.append(old[:60])

with io.open(path, "w", encoding="utf-8") as f:
    f.write(text)

print("applied:", len(pairs) - len(missing), "of", len(pairs))
for m in missing:
    print("NOT FOUND:", m)
