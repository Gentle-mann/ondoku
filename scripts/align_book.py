#!/usr/bin/env python3
"""
align_book.py — transcribe a Japanese audiobook MP3 and produce an alignment JSON
for use with ondoku's "Bring Your Own Audiobook" feature.

Usage:
  python scripts/align_book.py audio.mp3 -o book.json [options]

  # With explicit title / author
  python scripts/align_book.py audio.mp3 -t "走れメロス" -a "太宰治" -o output.json

  # With a reference transcript (one sentence per line — aligns faster & more accurately)
  python scripts/align_book.py audio.mp3 --text transcript.txt -o output.json

Requirements:
  pip install faster-whisper
  Optional (furigana): pip install fugashi unidic-lite

Output JSON format:
  {
    "title": "...",
    "author": "...",
    "sentences": [
      {
        "start": 1.23,
        "end": 5.67,
        "text": "日本語のテキスト",
        "furigana": [{"word": "日本語", "reading": "にほんご"}, ...]
      },
      ...
    ]
  }
"""

import argparse
import json
import os
import re
import sys

# ── Sentence splitting ────────────────────────────────────────────────────────

_SENTENCE_END = re.compile(r'[。！？\.\!\?]+')

def split_sentences(text: str) -> list[str]:
    """Split a block of Japanese text into sentences at 。！？."""
    parts = _SENTENCE_END.split(text)
    result = []
    # Reattach the punctuation to the preceding part
    boundaries = [m.end() for m in _SENTENCE_END.finditer(text)]
    prev = 0
    for end in boundaries:
        s = text[prev:end].strip()
        if s:
            result.append(s)
        prev = end
    tail = text[prev:].strip()
    if tail:
        result.append(tail)
    return result if result else [text.strip()]


# ── Furigana generation ───────────────────────────────────────────────────────

def add_furigana(sentences: list[dict]) -> list[dict]:
    """Add furigana field to each sentence using fugashi (optional)."""
    try:
        import fugashi
        tagger = fugashi.Tagger()
    except ImportError:
        print('[align_book] fugashi not installed — skipping furigana', file=sys.stderr)
        print('[align_book]   pip install fugashi unidic-lite', file=sys.stderr)
        return sentences

    results = []
    for sent in sentences:
        furigana = []
        for word in tagger(sent['text']):
            surface = word.surface
            # MeCab feature: [0]=pos, [7]=reading (katakana)
            features = word.feature_raw.split(',') if word.feature_raw else []
            reading_kana = features[7] if len(features) > 7 else '*'
            if reading_kana == '*' or reading_kana == surface:
                continue
            # Convert katakana reading to hiragana
            reading = ''.join(
                chr(ord(c) - 0x60) if '\u30A1' <= c <= '\u30F6' else c
                for c in reading_kana
            )
            # Only include if surface contains kanji
            has_kanji = any('\u4E00' <= c <= '\u9FFF' for c in surface)
            if has_kanji:
                furigana.append({'word': surface, 'reading': reading})
        results.append({**sent, 'furigana': furigana})
    return results


# ── Transcription ─────────────────────────────────────────────────────────────

def transcribe(audio_path: str, model_size: str = 'medium') -> list[dict]:
    """
    Use faster-whisper to transcribe audio and return sentence-level segments
    with start/end times.
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print('[align_book] faster-whisper not installed.', file=sys.stderr)
        print('[align_book]   pip install faster-whisper', file=sys.stderr)
        sys.exit(1)

    print(f'[align_book] loading Whisper model: {model_size}', file=sys.stderr)
    model = WhisperModel(model_size, device='auto', compute_type='auto')

    print(f'[align_book] transcribing: {audio_path}', file=sys.stderr)
    segments, info = model.transcribe(
        audio_path,
        language='ja',
        vad_filter=True,
        vad_parameters={'min_silence_duration_ms': 300},
    )

    print(f'[align_book] language: {info.language}  duration: {info.duration:.1f}s', file=sys.stderr)

    sentences = []
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        # Split long segments at sentence boundaries
        parts = split_sentences(text)
        if len(parts) == 1:
            sentences.append({'start': round(seg.start, 2), 'end': round(seg.end, 2), 'text': text})
        else:
            # Distribute time proportionally across sub-sentences
            total_chars = sum(len(p) for p in parts)
            t = seg.start
            for part in parts:
                frac = len(part) / total_chars if total_chars > 0 else 1 / len(parts)
                end_t = t + (seg.end - seg.start) * frac
                sentences.append({'start': round(t, 2), 'end': round(end_t, 2), 'text': part})
                t = end_t

    return sentences


# ── Alignment to reference text ───────────────────────────────────────────────

def align_to_reference(segments: list[dict], ref_lines: list[str]) -> list[dict]:
    """
    Given Whisper word segments and reference lines (one sentence per line),
    attempt to snap each line to the nearest segment boundary.
    This is a best-effort greedy alignment — not forced alignment.
    """
    if not segments:
        return []

    # Build a merged text from segments for matching
    all_text = ''.join(s['text'] for s in segments)

    aligned = []
    seg_idx = 0
    current_start = segments[0]['start'] if segments else 0.0

    for line in ref_lines:
        line = line.strip()
        if not line:
            continue
        # Find the segment where this line appears (approximate)
        end_time = segments[-1]['end']
        for i in range(seg_idx, len(segments)):
            if line[:4] in segments[i]['text'] or i == len(segments) - 1:
                end_time = segments[min(i + 1, len(segments) - 1)]['end']
                seg_idx = i
                break
        aligned.append({
            'start': round(current_start, 2),
            'end': round(end_time, 2),
            'text': line,
        })
        current_start = end_time

    return aligned


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Align a Japanese audiobook for ondoku.')
    parser.add_argument('audio', help='Path to audio file (MP3, M4A, etc.)')
    parser.add_argument('-o', '--output', default=None, help='Output JSON path (default: <audio>.json)')
    parser.add_argument('-t', '--title', default='', help='Book title')
    parser.add_argument('-a', '--author', default='', help='Author')
    parser.add_argument('--text', default=None, help='Reference transcript (.txt, one sentence per line)')
    parser.add_argument('--model', default='medium', help='Whisper model size (tiny/base/small/medium/large-v3)')
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        print(f'[align_book] audio file not found: {args.audio}', file=sys.stderr)
        sys.exit(1)

    output_path = args.output or os.path.splitext(args.audio)[0] + '.json'
    title = args.title or os.path.splitext(os.path.basename(args.audio))[0]
    author = args.author or ''

    # Transcribe
    segments = transcribe(args.audio, model_size=args.model)
    print(f'[align_book] transcribed {len(segments)} segments', file=sys.stderr)

    # Optionally align to reference
    if args.text:
        with open(args.text, encoding='utf-8') as f:
            ref_lines = [l.strip() for l in f if l.strip()]
        print(f'[align_book] aligning to {len(ref_lines)} reference lines', file=sys.stderr)
        sentences = align_to_reference(segments, ref_lines)
    else:
        sentences = segments

    # Add furigana
    sentences = add_furigana(sentences)
    print(f'[align_book] {len(sentences)} sentences ready', file=sys.stderr)

    result = {
        'title': title,
        'author': author,
        'sentences': sentences,
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f'[align_book] wrote {output_path}', file=sys.stderr)
    print(f'\nDone! Upload {output_path} + {os.path.basename(args.audio)} in ondoku → Add Book.')


if __name__ == '__main__':
    main()
