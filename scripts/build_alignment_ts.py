#!/usr/bin/env python3
"""
Build src/lib/alignment.ts from the per-episode aligned JSON files.

The JSON files are the source of truth for built-in audiobook timings; this
script keeps the generated TypeScript data reproducible.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DATA_DIR = Path("scripts/data")
OUT = Path("src/lib/alignment.ts")
EP_FILES = [f"yanerura_N1_2_ep{i:02d}.mp3" for i in range(1, 9)]


def ts_string(value: str) -> str:
    return "`" + value.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${") + "`"


def number(value: Any) -> str:
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(round(value, 3)).rstrip("0").rstrip(".")
    return str(value)


def entry_line(entry: dict[str, Any], sentence_id: int, filename: str) -> str:
    parts = [
        f"id:{sentence_id}",
        f'file:"{filename}"',
        f"start:{number(entry['start'])}",
        f"end:{number(entry['end'])}",
        f"text:{ts_string(entry['text'])}",
    ]
    if entry.get("furigana"):
        parts.append(
            "furigana:"
            + json.dumps(entry["furigana"], ensure_ascii=False, separators=(",", ":"))
        )
    if entry.get("words"):
        parts.append(
            "words:" + json.dumps(entry["words"], ensure_ascii=False, separators=(",", ":"))
        )
    return "  {" + ",".join(parts) + "},"


def main() -> None:
    lines = [
        "// AUTO-GENERATED - do not edit by hand",
        "",
        "export interface AlignedWord {",
        "  text: string",
        "  start: number",
        "  end: number",
        "}",
        "",
        "export interface AlignedSentence {",
        "  id: number",
        "  file: string",
        "  start: number",
        "  end: number",
        "  text: string",
        "  furigana?: { word: string; reading: string }[]",
        "  words?: AlignedWord[]",
        "}",
        "",
        "export function findActiveWord(words: AlignedWord[], currentTime: number): number {",
        "  for (let i = words.length - 1; i >= 0; i--) {",
        "    if (currentTime >= words[i].start) return i",
        "  }",
        "  return -1",
        "}",
        "",
    ]

    sentence_id = 0
    const_names: list[str] = []
    for index, filename in enumerate(EP_FILES, start=1):
        path = DATA_DIR / f"ep{index:02d}_pdf_aligned.json"
        entries = json.loads(path.read_text(encoding="utf-8"))
        const_name = f"YANERURA_N1_2_EP{index:02d}"
        const_names.append(const_name)

        lines.append(f"export const {const_name}: AlignedSentence[] = [")
        for entry in entries:
            lines.append(entry_line(entry, sentence_id, filename))
            sentence_id += 1
        lines.append("]")
        lines.append("")

    lines.extend(
        [
            "export const YANEURA_ALL: AlignedSentence[] = [",
            *(f"  ...{name}," for name in const_names),
            "]",
            "",
            "export function findActiveSentence(sentences: AlignedSentence[], currentTime: number, file: string): number {",
            "  // Find the last sentence whose start <= currentTime.",
            "  // With force-aligned data there are natural gaps between sentences,",
            "  // so we can't rely on strict start/end containment.",
            "  let result = -1",
            "  for (let i = 0; i < sentences.length; i++) {",
            "    const s = sentences[i]",
            "    if (s.file !== file) continue",
            "    if (s.start <= currentTime) {",
            "      result = i",
            "    } else {",
            "      break",
            "    }",
            "  }",
            "  return result",
            "}",
            "",
        ]
    )

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT} with {sentence_id} sentences")


if __name__ == "__main__":
    main()
