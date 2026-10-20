"""Validated output preferences; independent of the transcript language."""
import json
from pathlib import Path

LANGUAGES = json.loads(Path(__file__).with_name("languages.json").read_text())
LANGUAGE_BY_CODE = {row["code"]: row for row in LANGUAGES}


def language_instruction(code: str) -> str:
    if code == "auto":
        return ("OUTPUT LANGUAGE: Follow the language explicitly requested in the latest learner question, "
                "otherwise use that question's language. For a generic English shortcut, use the most recent "
                "learner language preference in the conversation, falling back to English. "
                "The source/video language must not force the answer language.")
    language = LANGUAGE_BY_CODE[code]
    return (f"OUTPUT LANGUAGE: {language['name']} ({language['native']}; {code}). "
            "Write the entire answer in this selected language, including summaries, quiz questions, answer keys, "
            "headings, and limitations. This explicit application preference overrides the question, history, and "
            "video language. Keep code identifiers, proper nouns and source labels such as [S1] intact. "
            "Do not add an English translation or bilingual commentary.")
