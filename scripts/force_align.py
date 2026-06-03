#!/usr/bin/env python3
"""
force_align.py — forced word-level alignment using stable-ts.

Unlike regular Whisper transcription (which guesses what was said then
estimates timestamps), this uses forced alignment: you provide the exact
text, and the model finds precisely where each word is spoken in the audio.

Usage:
  python scripts/force_align.py \
    --audio public/audio/yanerura_N1_2_ep01.mp3 \
    --sentences scripts/data/ep01_sentences.txt \
    --out scripts/data/ep01_word_aligned.json

Requires: pip install stable-ts fugashi unidic-lite
"""

import sys
import ssl
import json
import argparse
from pathlib import Path

import stable_whisper
import fugashi

ssl._create_default_https_context = ssl._create_unverified_context

# ── MeCab word segmentation ──────────────────────────────────────────────────

_tagger = None

def get_tagger():
    global _tagger
    if _tagger is None:
        _tagger = fugashi.Tagger()
    return _tagger


def mecab_segment(text: str) -> list[str]:
    """Split Japanese text into morphological words."""
    return [tok.surface for tok in get_tagger()(text)]


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Force-align sentences to audio (word-level)")
    parser.add_argument("--audio", required=True, help="Path to audio file")
    parser.add_argument("--sentences", required=True, help="Text file, one sentence per line")
    parser.add_argument("--out", required=True, help="Output JSON path")
    parser.add_argument("--start-id", type=int, default=0)
    parser.add_argument("--file", default=None, help="Audio filename for JSON (default: basename)")
    parser.add_argument("--model", default="turbo", help="Whisper model (default: turbo)")
    args = parser.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.exists():
        sys.exit(f"Audio not found: {audio_path}")

    audio_filename = args.file or audio_path.name

    # Load sentences
    lines = Path(args.sentences).read_text(encoding="utf-8").splitlines()
    sentences = [l.strip() for l in lines if l.strip()]
    print(f"Loaded {len(sentences)} sentences", flush=True)

    # Load model
    print(f"Loading Whisper model '{args.model}'…", flush=True)
    model = stable_whisper.load_model(args.model)

    # Force-align: give the model the exact text + audio
    # stable-ts will use Whisper's acoustic model to find where each word
    # appears in the audio — no transcription guessing involved.
    full_text = "\n".join(sentences)
    print(f"Running forced alignment on {audio_path.name}…", flush=True)
    result = model.align(
        str(audio_path),
        full_text,
        language="ja",
    )

    # Extract word-level timestamps from the result
    # stable-ts returns segments, each with words that have precise timestamps
    all_words = []
    for segment in result.segments:
        for word in segment.words:
            all_words.append({
                "text": word.word.strip(),
                "start": round(word.start, 3),
                "end": round(word.end, 3),
            })

    print(f"Got {len(all_words)} aligned tokens from model", flush=True)

    # Now map these aligned tokens back to our sentences
    # We'll walk through sentence text character by character, matching to aligned words
    results = []
    token_cursor = 0

    for i, sentence in enumerate(sentences):
        sid = args.start_id + i

        # Segment sentence into proper Japanese words via MeCab
        mecab_words = mecab_segment(sentence)

        # Match MeCab words to aligned tokens by consuming characters
        sentence_words = []
        chars_needed = list(sentence.replace(" ", "").replace("\u3000", ""))
        char_idx = 0

        for mword in mecab_words:
            mchars = list(mword)
            if not mchars:
                continue

            # Find the aligned token(s) that cover this MeCab word
            word_start = None
            word_end = None
            chars_to_match = len(mchars)
            matched = 0
            scan = token_cursor

            while matched < chars_to_match and scan < len(all_words):
                tok = all_words[scan]
                tok_text = tok["text"].replace(" ", "")

                if not tok_text:
                    scan += 1
                    continue

                # Check character overlap
                overlap = 0
                for ch in tok_text:
                    if matched + overlap < chars_to_match and ch == mchars[matched + overlap]:
                        overlap += 1

                if overlap > 0:
                    if word_start is None:
                        word_start = tok["start"]
                    word_end = tok["end"]
                    matched += overlap
                    scan += 1
                else:
                    # No overlap — might be a mismatch, skip this token
                    scan += 1

                if scan - token_cursor > chars_to_match + 10:
                    break

            if word_start is not None:
                sentence_words.append({
                    "text": mword,
                    "start": word_start,
                    "end": word_end,
                })
                token_cursor = max(token_cursor, scan - 1)
            else:
                # Fallback: estimate from neighbors
                prev_end = sentence_words[-1]["end"] if sentence_words else 0.0
                sentence_words.append({
                    "text": mword,
                    "start": prev_end,
                    "end": prev_end + 0.05,
                })

        # Advance token cursor past this sentence
        if sentence_words:
            # Find next token after our last matched word's end time
            while token_cursor < len(all_words) and all_words[token_cursor]["end"] <= sentence_words[-1]["end"]:
                token_cursor += 1

        sent_start = sentence_words[0]["start"] if sentence_words else 0.0
        sent_end = sentence_words[-1]["end"] if sentence_words else 0.0

        entry = {
            "id": sid,
            "file": audio_filename,
            "start": sent_start,
            "end": sent_end,
            "text": sentence,
            "words": sentence_words,
        }
        results.append(entry)
        print(f"  [{sid}] {sent_start:.2f}s – {sent_end:.2f}s  ({len(sentence_words)} words)  {sentence[:40]}", flush=True)

    # Write output
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"\nWrote {len(results)} sentences to {args.out}", flush=True)


if __name__ == "__main__":
    main()
