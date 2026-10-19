"""Conservative detection of empty and collapsed/repeating caption text."""
import re


def informative(text: str) -> bool:
    words = re.findall(r"[^\W_]+", text.casefold(), flags=re.UNICODE)
    if not words or not any(character.isalpha() for character in text):
        return False
    # Do not mistake corrupted caption tracks for meaningful learning evidence.
    if len(words) >= 5 and len(set(words)) <= 2:
        return False
    return len(text.strip()) >= 12 and len(set(words)) >= 3


def caption_quality(rows) -> float:
    if not rows:
        return 0.0
    return sum(informative(row.get("text", "")) for row in rows) / len(rows)
