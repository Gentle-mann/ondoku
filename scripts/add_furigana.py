#!/usr/bin/env python3
"""
add_furigana.py — annotate sentences in alignment_all.json with furigana readings.

Uses the ondoku_dict.db to look up kanji words and their primary readings.
Greedy longest-match tokenizer: at each position tries the longest matching
kanji_form first, skips pure-kana and punctuation spans.

Usage:
  python scripts/add_furigana.py \
    --db public/dict/ondoku_dict.db \
    --alignment scripts/data/alignment_all.json \
    --out scripts/data/alignment_all.json
"""

import json
import sqlite3
import unicodedata
import argparse
import re
from pathlib import Path


def has_kanji(text: str) -> bool:
    return any('\u4E00' <= ch <= '\u9FFF' or '\u3400' <= ch <= '\u4DBF' for ch in text)


def kata_to_hira(text: str) -> str:
    return ''.join(
        chr(ord(ch) - 0x60) if '\u30A1' <= ch <= '\u30F6' else ch
        for ch in text
    )


def build_lookup(db_path: str) -> dict[str, str]:
    """
    Build a dict: kanji_form → primary hiragana reading.
    Only includes forms that contain at least one kanji character.
    """
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    # Get the first reading for each kanji form (ordered by entry_id for consistency)
    cur.execute("""
        SELECT kf.form, rf.form
        FROM kanji_forms kf
        JOIN reading_forms rf ON kf.entry_id = rf.entry_id
        ORDER BY kf.entry_id, rf.rowid
    """)
    lookup: dict[str, str] = {}
    for kanji_form, reading in cur.fetchall():
        if kanji_form not in lookup and has_kanji(kanji_form):
            lookup[kanji_form] = kata_to_hira(reading)
    conn.close()
    print(f"Loaded {len(lookup):,} kanji→reading pairs.", flush=True)
    return lookup


def tokenize(text: str, lookup: dict[str, str], max_len: int = 10) -> list[dict]:
    """
    Greedy longest-match scan over text.
    Returns list of {word, reading} for kanji spans found.
    """
    results = []
    i = 0
    n = len(text)
    while i < n:
        # Skip if current char has no kanji in any window starting here
        if not has_kanji(text[i]):
            i += 1
            continue
        # Try longest match first
        matched = False
        for length in range(min(max_len, n - i), 0, -1):
            candidate = text[i:i + length]
            if candidate in lookup:
                results.append({"word": candidate, "reading": lookup[candidate]})
                i += length
                matched = True
                break
        if not matched:
            i += 1
    return results


def deduplicate(furigana: list[dict]) -> list[dict]:
    """Remove duplicate consecutive same-word entries."""
    seen: set[str] = set()
    result = []
    for f in furigana:
        key = f["word"]
        if key not in seen:
            seen.add(key)
            result.append(f)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--alignment", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    lookup = build_lookup(args.db)

    data = json.loads(Path(args.alignment).read_text(encoding="utf-8"))
    print(f"Processing {len(data)} sentences…", flush=True)

    for s in data:
        furigana = tokenize(s["text"], lookup)
        if furigana:
            s["furigana"] = furigana
        elif "furigana" in s:
            del s["furigana"]

    Path(args.out).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    annotated = sum(1 for s in data if s.get("furigana"))
    print(f"Annotated {annotated}/{len(data)} sentences. Written to {args.out}", flush=True)


if __name__ == "__main__":
    main()
