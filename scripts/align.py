#!/usr/bin/env python3
"""
align.py — align text sentences to audio using Groq Whisper word timestamps.

Usage:
  python scripts/align.py \
    --audio public/audio/yanerura_N1_2_ep02.mp3 \
    --sentences scripts/data/ep02_sentences.txt \
    --start-id 32 \
    --out scripts/data/ep02_aligned.json

Sentences file format: one sentence per line (blank lines ignored).

Output: JSON array of AlignedSentence objects, ready to paste into alignment.ts.

Requires: pip install openai-whisper
"""

import os
import sys
import ssl
import json
import argparse
import difflib
import unicodedata
from pathlib import Path
import whisper

ssl._create_default_https_context = ssl._create_unverified_context


# ── Transcription ─────────────────────────────────────────────────────────────

_model = None

def transcribe(audio_path: str, model_name: str = "turbo") -> list[dict]:
    """
    Transcribe with local Whisper and return word-level timestamps.
    Returns: [{word: str, start: float, end: float}, ...]
    """
    global _model
    path = Path(audio_path)

    if not path.exists():
        sys.exit(f"Error: audio file not found: {audio_path}")

    size_mb = path.stat().st_size / 1_048_576
    print(f"  Loading Whisper model '{model_name}'…", flush=True)
    if _model is None:
        _model = whisper.load_model(model_name)

    print(f"  Transcribing {path.name} ({size_mb:.1f} MB)…", flush=True)
    result = _model.transcribe(
        str(path),
        language="ja",
        word_timestamps=True,
        verbose=False,
    )

    words = []
    for segment in result.get("segments", []):
        for w in segment.get("words", []):
            words.append({
                "word": w["word"],
                "start": round(w["start"], 3),
                "end": round(w["end"], 3),
            })

    print(f"  Got {len(words)} words from Whisper.", flush=True)
    return words


# ── Character-level alignment ─────────────────────────────────────────────────

def normalize(text: str) -> str:
    """Strip spaces and normalize fullwidth characters for matching."""
    text = text.replace(" ", "").replace("\u3000", "")
    return unicodedata.normalize("NFKC", text)


def build_char_index(words: list[dict]) -> tuple[str, list[int]]:
    """
    Concatenate word strings (no spaces) and build a mapping:
      char_to_word[i] = index into `words` for character i in the concatenated string.
    Returns (full_text, char_to_word).
    """
    parts = []
    char_to_word = []
    for wi, w in enumerate(words):
        token = normalize(w["word"])
        parts.append(token)
        char_to_word.extend([wi] * len(token))
    return "".join(parts), char_to_word


def find_sentence_span(
    transcript: str,
    char_to_word: list[int],
    words: list[dict],
    sentence: str,
    search_from: int = 0,
    threshold: float = 0.45,
) -> tuple[float, float, int] | None:
    """
    Find the best-matching region for `sentence` in `transcript[search_from:]`.
    Returns (start_sec, end_sec, char_end_pos) or None.

    Uses SequenceMatcher to handle minor Whisper transcription differences
    (different kanji choices, kana vs kanji, etc.).
    """
    needle = normalize(sentence)
    if not needle:
        return None

    # Search window: look ahead generously to handle pacing variation
    window_start = search_from
    window_end = min(len(transcript), search_from + len(needle) * 8 + 300)
    haystack = transcript[window_start:window_end]

    # Try exact match first (fast path)
    idx = haystack.find(needle)
    if idx != -1:
        abs_start = window_start + idx
        abs_end = abs_start + len(needle)
    else:
        # Fuzzy match: slide a window of the same length, pick highest ratio
        best_ratio = 0.0
        best_start = window_start
        step = max(1, len(needle) // 6)
        for i in range(0, max(1, len(haystack) - len(needle) + 1), step):
            candidate = haystack[i : i + len(needle)]
            ratio = difflib.SequenceMatcher(None, needle, candidate, autojunk=False).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_start = window_start + i

        if best_ratio < threshold:
            return None

        abs_start = best_start
        abs_end = abs_start + len(needle)

    # Map char positions to word indices
    if abs_start >= len(char_to_word) or abs_end > len(char_to_word):
        return None

    word_start_idx = char_to_word[abs_start]
    word_end_idx = char_to_word[min(abs_end, len(char_to_word)) - 1]

    start_sec = words[word_start_idx]["start"]
    end_sec = words[word_end_idx]["end"]

    return start_sec, end_sec, abs_end


# ── Main alignment ────────────────────────────────────────────────────────────

def align(
    words: list[dict],
    sentences: list[str],
    audio_filename: str,
    start_id: int,
) -> list[dict]:
    """
    Match each sentence to a time range in the Whisper word list.
    Returns AlignedSentence[] (without furigana — add that separately).
    """
    transcript, char_to_word = build_char_index(words)
    print(f"  Transcript: {len(transcript)} chars across {len(words)} words.", flush=True)

    results = []
    cursor = 0
    failed = []

    for i, sentence in enumerate(sentences):
        sid = start_id + i
        match = find_sentence_span(transcript, char_to_word, words, sentence, cursor)

        if match is None:
            print(f"  [WARN] sentence {sid} not found: {sentence[:40]!r}", flush=True)
            failed.append(sid)
            # Don't advance cursor — try next sentence from same position
            results.append({
                "id": sid,
                "file": audio_filename,
                "start": -1,
                "end": -1,
                "text": sentence,
            })
        else:
            start_sec, end_sec, new_cursor = match
            results.append({
                "id": sid,
                "file": audio_filename,
                "start": start_sec,
                "end": end_sec,
                "text": sentence,
            })
            cursor = new_cursor
            print(f"  [{sid}] {start_sec:.2f}s – {end_sec:.2f}s  {sentence[:40]}", flush=True)

    if failed:
        print(f"\n  {len(failed)} sentence(s) not matched, interpolating from neighbors…", flush=True)
        _interpolate_missing(results)

    return results


def _interpolate_missing(results: list[dict]) -> None:
    """
    For any entry with start == -1, estimate its time range from
    the nearest matched neighbors on either side.
    """
    n = len(results)
    for i, entry in enumerate(results):
        if entry["start"] != -1:
            continue

        # Find nearest matched neighbor before and after
        prev_end = None
        for j in range(i - 1, -1, -1):
            if results[j]["start"] != -1:
                prev_end = results[j]["end"]
                break

        next_start = None
        for j in range(i + 1, n):
            if results[j]["start"] != -1:
                next_start = results[j]["start"]
                break

        if prev_end is not None and next_start is not None:
            # Count how many consecutive unmatched sentences share this gap
            gap_indices = [i]
            for j in range(i + 1, n):
                if results[j]["start"] == -1:
                    gap_indices.append(j)
                else:
                    break
            gap = next_start - prev_end
            slot = gap / (len(gap_indices) + 1)
            for k, gi in enumerate(gap_indices):
                s = round(prev_end + slot * (k + 1), 2)
                e = round(prev_end + slot * (k + 2), 2)
                results[gi]["start"] = s
                results[gi]["end"] = e
                print(f"  [interpolated] id={results[gi]['id']} {s}s – {e}s", flush=True)
        elif prev_end is not None:
            results[i]["start"] = prev_end
            results[i]["end"] = round(prev_end + 3.0, 2)
        elif next_start is not None:
            results[i]["start"] = round(next_start - 3.0, 2)
            results[i]["end"] = next_start


# ── CLI ───────────────────────────────────────────────────────────────────────

def load_sentences(path: str) -> list[str]:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return [l.strip() for l in lines if l.strip()]


def main():
    parser = argparse.ArgumentParser(description="Align sentences to audio via Groq Whisper")
    parser.add_argument("--audio", required=True, help="Path to MP3/M4A file")
    parser.add_argument("--sentences", required=True, help="Text file, one sentence per line")
    parser.add_argument("--start-id", type=int, default=0, help="ID offset for first sentence")
    parser.add_argument("--out", default=None, help="Output JSON path (default: stdout)")
    parser.add_argument(
        "--file",
        default=None,
        help="Filename to embed in JSON (default: basename of --audio)",
    )
    parser.add_argument(
        "--model",
        default="turbo",
        help="Whisper model: tiny, base, small, medium, large, turbo (default: turbo)",
    )
    args = parser.parse_args()

    audio_filename = args.file or Path(args.audio).name
    sentences = load_sentences(args.sentences)
    print(f"Loaded {len(sentences)} sentences from {args.sentences}", flush=True)

    words = transcribe(args.audio, args.model)
    aligned = align(words, sentences, audio_filename, args.start_id)

    output = json.dumps(aligned, ensure_ascii=False, indent=2)

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"\nWrote {len(aligned)} entries to {args.out}", flush=True)
    else:
        print("\n--- OUTPUT ---")
        print(output)

    # Print TypeScript snippet for easy copy-paste
    print("\n--- TypeScript (paste into alignment.ts) ---")
    for entry in aligned:
        if entry["start"] >= 0:
            print(
                f'  {{ id: {entry["id"]}, file: \'{entry["file"]}\', '
                f'start: {entry["start"]}, end: {entry["end"]}, '
                f'text: \'{entry["text"]}\' }},'
            )


if __name__ == "__main__":
    main()
