"""Conservative monotonic word anchors: preserve supplied text, expose unmatched rows."""
from difflib import SequenceMatcher
import re
import unicodedata

from lyrics import repair_lines


def tokens(text):
    normalized = unicodedata.normalize("NFKD", text.casefold().replace("ı", "i"))
    return re.findall(r"[^\W_]+", "".join(c for c in normalized if not unicodedata.combining(c)), re.UNICODE)


def align_reference(reference, words, duration):
    wanted, ranges, heard, positions = [], [], [], []
    for row in reference:
        start = len(wanted)
        wanted.extend(tokens(row["text"]))
        ranges.append((start, len(wanted)))
    for word in words:
        for token in tokens(word["word"]):
            heard.append(token)
            positions.append(word)
    anchors = {}
    for block in SequenceMatcher(None, wanted, heard, autojunk=False).get_matching_blocks():
        for index in range(block.size):
            anchors[block.a+index] = positions[block.b+index]
    result = []
    for row, (first, last) in zip(reference, ranges):
        cue = dict(row)
        if cue.get("start") is not None and cue.get("end") is not None:
            result.append(cue)
            continue
        matched = [anchors[i] for i in range(first, last) if i in anchors]
        coverage = len(matched)/max(1, last-first)
        # Both boundaries must match: never fabricate onset/end from interior words.
        bounded = first in anchors and last-1 in anchors
        if matched and coverage >= .65 and bounded:
            start, end = matched[0]["start"], matched[-1]["end"]
            if 0 < end-start <= max(12, (last-first)*1.5):
                cue.update(start=start, end=end, confidence=round(coverage * sum(w["probability"] for w in matched)/len(matched), 3), review=True)
            else:
                cue.update(start=None, end=None, confidence=None, review=True)
        else:
            cue.update(start=None, end=None, confidence=None, review=True)
        result.append(cue)
    return repair_lines(result, duration)
