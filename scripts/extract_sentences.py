#!/usr/bin/env python3
"""
extract_sentences.py — extract clean Japanese sentences from the Yaneura PDF.

Usage:
  python scripts/extract_sentences.py \
    --pdf "/Users/khalifaibrahim/Projects/Audiobooks/★yaneura_n1_n2.pdf" \
    --out scripts/data/all_sentences.txt

Outputs one sentence per line, with chapter boundaries marked as:
  ## chapter N
"""

import re
import argparse
import unicodedata
from pathlib import Path
import pdfplumber

# Lines to strip from every page
SKIP_PATTERNS = [
    "YUYU の日本語Podcast",
    "Discord Study Group",
    "Youtube YUYU",
    "E-book On-line Shop",
    "Spotify Apple Podcasts",
    "もくじ",
    "episode",
    "ページ",
    "著：",
    "訳：",
    "・",
]

# Single-character chapter markers
CHAPTER_MARKERS = set("一二三四五六七八")

# Hiragana/katakana unicode ranges — used to detect furigana-only lines
HIRAGANA = (0x3040, 0x309F)
KATAKANA = (0x30A0, 0x30FF)


def is_kana_only(line: str) -> bool:
    """Return True if the line is short and contains mostly kana (furigana)."""
    line = line.strip()
    # Only count non-space, non-ASCII characters for length
    jp_chars = [ch for ch in line if ord(ch) > 0x7F]
    if len(jp_chars) > 8:
        return False
    kana = sum(
        1 for ch in jp_chars
        if HIRAGANA[0] <= ord(ch) <= HIRAGANA[1]
        or KATAKANA[0] <= ord(ch) <= KATAKANA[1]
    )
    return kana / max(len(jp_chars), 1) > 0.85


def clean_line(line: str) -> str:
    """Remove inline furigana artifacts and normalize spaces."""
    # Remove spaces between Japanese characters (e.g. "郷田 三郎" → "郷田三郎")
    line = re.sub(r'(?<=[\u3000-\u9FFF])\s+(?=[\u3000-\u9FFF])', '', line)
    # Strip leading page numbers (e.g. "1まだ一つも" → "まだ一つも")
    line = re.sub(r'^\d+(?=[^\d\s])', '', line)
    # Normalize NFKC
    line = unicodedata.normalize("NFKC", line)
    return line.strip()


def should_skip_line(line: str) -> bool:
    line = line.strip()
    if not line:
        return True
    if any(p in line for p in SKIP_PATTERNS):
        return True
    if is_kana_only(line):
        return True
    return False


def extract_text(pdf_path: str) -> list[tuple[int, str]]:
    """
    Returns list of (chapter_number, raw_text) — one entry per page.
    Chapter 0 = synopsis (page 2).
    """
    pages_text = []
    current_chapter = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            if page_num == 0:
                continue  # skip TOC

            text = page.extract_text() or ""
            lines = text.splitlines()
            kept = []

            for line in lines:
                line = line.strip()
                if should_skip_line(line):
                    continue

                # Detect chapter marker lines (single kanji like 一, 二, ...)
                if line in CHAPTER_MARKERS:
                    current_chapter += 1
                    kept.append(f"\n## chapter {current_chapter}\n")
                    continue

                kept.append(clean_line(line))

            pages_text.append((current_chapter, "\n".join(kept)))

    return pages_text


def split_sentences(text: str) -> list[str]:
    """
    Split Japanese text into sentences on 。！？
    Handles multi-line text by joining lines first.
    """
    # Join lines — continuation lines don't end with sentence-final punctuation
    joined_lines = []
    buffer = ""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            if buffer:
                joined_lines.append(buffer)
                buffer = ""
            continue
        if line.startswith("##"):
            if buffer:
                joined_lines.append(buffer)
                buffer = ""
            joined_lines.append(line)
            continue
        buffer += line

        # If line ends a sentence, flush buffer
        if buffer and buffer[-1] in "。！？」":
            joined_lines.append(buffer)
            buffer = ""

    if buffer:
        joined_lines.append(buffer)

    # Now split on sentence-final punctuation within joined lines
    sentences = []
    for line in joined_lines:
        if line.startswith("##"):
            sentences.append(line)
            continue

        # Split on 。！？ but keep punctuation attached
        parts = re.split(r'(?<=[。！？])', line)
        for part in parts:
            part = part.strip()
            if part:
                sentences.append(part)

    return sentences


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    pages = extract_text(args.pdf)
    full_text = "\n".join(text for _, text in pages)

    sentences = split_sentences(full_text)

    # Filter out empty and very short non-Japanese lines
    clean = []
    first_story = True
    for s in sentences:
        if s.startswith("##"):
            clean.append(s)
        elif len(s) >= 4 and any('\u3000' <= ch <= '\u9FFF' or '\u3040' <= ch <= '\u30FF' for ch in s):
            # Strip author name prefix from very first sentence
            if first_story:
                s = re.sub(r'^江戸川\s*乱歩', '', s).strip()
                first_story = False
            clean.append(s)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text("\n".join(clean), encoding="utf-8")

    # Stats
    chapter_counts = {}
    story_sentences = [s for s in clean if not s.startswith("##")]
    for s in clean:
        if s.startswith("## chapter"):
            current = int(s.split()[-1])
            chapter_counts[current] = 0
        elif clean.index(s) > 0:
            # count under current chapter
            for i in range(clean.index(s) - 1, -1, -1):
                if clean[i].startswith("## chapter"):
                    ch = int(clean[i].split()[-1])
                    chapter_counts[ch] = chapter_counts.get(ch, 0) + 1
                    break

    print(f"Total sentences: {len(story_sentences)}")
    print(f"Output: {args.out}")
    print("\nFirst 5 sentences:")
    count = 0
    for s in clean:
        if not s.startswith("##") and count < 5:
            print(f"  {s[:80]}")
            count += 1


if __name__ == "__main__":
    main()
