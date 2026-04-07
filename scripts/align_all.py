#!/usr/bin/env python3
"""
align_all.py — align ALL episodes using chapter markers from all_sentences.txt.

The sentences file uses ## chapter N markers that map 1:1 to audio episodes.
Synopsis sentences (before ## chapter 1) are grouped with episode 1.

Usage:
  python scripts/align_all.py \
    --sentences scripts/data/all_sentences.txt \
    --audio-dir /Users/khalifaibrahim/Projects/Audiobooks \
    --out scripts/data/alignment_all.json

Audio files expected: yanerura_N1_2_ep01.mp3 ... yanerura_N1_2_ep08.mp3
"""

import ssl
ssl._create_default_https_context = ssl._create_unverified_context

import os
import sys
import json
import argparse
import difflib
import unicodedata
import re
from pathlib import Path
import whisper

_model = None

# ── Whisper ───────────────────────────────────────────────────────────────────

def transcribe(audio_path: str, model_name: str = "turbo") -> list[dict]:
    global _model
    path = Path(audio_path)
    if not path.exists():
        sys.exit(f"Error: audio not found: {audio_path}")
    if _model is None:
        print(f"  Loading Whisper '{model_name}'…", flush=True)
        _model = whisper.load_model(model_name)
    print(f"  Transcribing {path.name} ({path.stat().st_size/1_048_576:.1f} MB)…", flush=True)
    result = _model.transcribe(str(path), language="ja", word_timestamps=True, verbose=False)
    words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            words.append({"word": w["word"], "start": round(w["start"], 3), "end": round(w["end"], 3)})
    print(f"  {len(words)} words.", flush=True)
    return words

# ── Alignment helpers ─────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    text = text.replace(" ", "").replace("\u3000", "")
    return unicodedata.normalize("NFKC", text)

def normalize_for_match(text: str) -> str:
    """Normalize for fuzzy comparison: strip digits (PDF page numbers, numeral mismatches)."""
    text = normalize(text)
    text = re.sub(r'\d+', '', text)
    return text

def build_char_index(words: list[dict]) -> tuple[str, list[int], str]:
    """
    Returns (transcript, char_to_word, transcript_stripped) where
    transcript_stripped has digits removed for fuzzy matching.
    """
    parts, char_to_word = [], []
    for wi, w in enumerate(words):
        token = normalize(w["word"])
        parts.append(token)
        char_to_word.extend([wi] * len(token))
    transcript = "".join(parts)
    transcript_stripped = re.sub(r'\d+', '', transcript)
    return transcript, char_to_word, transcript_stripped

def find_span(transcript, char_to_word, words, sentence, search_from=0, threshold=0.45,
              transcript_stripped=None):
    needle = normalize(sentence)
    if not needle:
        return None
    window_start = search_from
    window_end = min(len(transcript), search_from + len(needle) * 8 + 300)
    haystack = transcript[window_start:window_end]

    # Try exact match first
    idx = haystack.find(needle)
    if idx != -1:
        abs_start = window_start + idx
        abs_end = abs_start + len(needle)
    else:
        best_ratio, best_start = 0.0, window_start
        step = max(1, len(needle) // 6)
        for i in range(0, max(1, len(haystack) - len(needle) + 1), step):
            r = difflib.SequenceMatcher(None, needle, haystack[i:i+len(needle)], autojunk=False).ratio()
            if r > best_ratio:
                best_ratio, best_start = r, window_start + i

        # If still below threshold, retry with digit-stripped versions
        if best_ratio < threshold and transcript_stripped is not None:
            needle_s = normalize_for_match(sentence)
            # Map search_from into stripped transcript (approx — strip up to search_from)
            stripped_from = len(re.sub(r'\d+', '', transcript[:search_from]))
            stripped_end = min(len(transcript_stripped), stripped_from + len(needle_s) * 8 + 300)
            haystack_s = transcript_stripped[stripped_from:stripped_end]
            for i in range(0, max(1, len(haystack_s) - len(needle_s) + 1), max(1, len(needle_s) // 6)):
                r = difflib.SequenceMatcher(None, needle_s, haystack_s[i:i+len(needle_s)], autojunk=False).ratio()
                if r > best_ratio:
                    best_ratio = r
                    # Map stripped position back to original transcript position
                    stripped_pos = stripped_from + i
                    # Find the original position: count non-digit chars up to stripped_pos
                    orig_pos = 0
                    count = 0
                    for ch in transcript[search_from:]:
                        if not ch.isdigit():
                            if count == stripped_pos - stripped_from:
                                break
                            count += 1
                        orig_pos += 1
                    best_start = search_from + orig_pos

        if best_ratio < threshold:
            return None
        abs_start, abs_end = best_start, best_start + len(needle)

    if abs_start >= len(char_to_word):
        return None
    wi_start = char_to_word[abs_start]
    wi_end = char_to_word[min(abs_end, len(char_to_word)) - 1]
    return words[wi_start]["start"], words[wi_end]["end"], abs_end

def detect_gaps(results: list[dict]) -> list[tuple[int, int]]:
    """
    Find runs of 2+ consecutive sentences crammed into a <2s window — likely misaligned.
    Returns list of (start_idx, end_idx) inclusive index ranges.
    """
    gaps = []
    n = len(results)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and abs(results[j + 1]["end"] - results[i]["start"]) < 2.0:
            j += 1
        if j > i:
            gaps.append((i, j))
            i = j + 1
        else:
            i += 1
    return gaps

def realign_gap(words, transcript, char_to_word, transcript_stripped,
                results, gap_start, gap_end, prev_cursor):
    """
    Re-attempt alignment for a suspicious gap region with looser settings.
    Searches from prev_cursor (end of last good sentence before the gap).
    """
    print(f"  [GAP] Re-aligning ids {results[gap_start]['id']}–{results[gap_end]['id']} from cursor {prev_cursor:.1f}s…", flush=True)

    # Find char cursor position in transcript corresponding to prev_cursor time
    char_cursor = 0
    for ci, wi in enumerate(char_to_word):
        if words[wi]["start"] >= prev_cursor:
            char_cursor = ci
            break

    for ri in range(gap_start, gap_end + 1):
        sentence = results[ri]["text"]
        match = find_span(transcript, char_to_word, words, sentence,
                          char_cursor, threshold=0.30,
                          transcript_stripped=transcript_stripped)
        if match:
            s, e, char_cursor = match
            results[ri]["start"] = s
            results[ri]["end"] = e
            print(f"    [fixed] id={results[ri]['id']} {s:.2f}–{e:.2f}  {sentence[:40]}", flush=True)
        else:
            print(f"    [still missing] id={results[ri]['id']}: {sentence[:40]!r}", flush=True)

def align_episode(words, sentences, audio_filename, start_id):
    transcript, char_to_word, transcript_stripped = build_char_index(words)
    results = []
    cursor = 0
    failed = []

    for i, sentence in enumerate(sentences):
        sid = start_id + i
        match = find_span(transcript, char_to_word, words, sentence, cursor,
                          transcript_stripped=transcript_stripped)
        if match is None:
            print(f"  [WARN] {sid}: {sentence[:40]!r}", flush=True)
            failed.append(len(results))
            results.append({"id": sid, "file": audio_filename, "start": -1, "end": -1, "text": sentence})
        else:
            s, e, cursor = match
            print(f"  [{sid}] {s:.2f}–{e:.2f}  {sentence[:45]}", flush=True)
            results.append({"id": sid, "file": audio_filename, "start": s, "end": e, "text": sentence})

    # Detect and re-align crammed sentence gaps
    gaps = detect_gaps(results)
    if gaps:
        print(f"  [GAP] Detected {len(gaps)} suspicious gap(s), re-aligning…", flush=True)
        for gap_start, gap_end in gaps:
            # Find the last good cursor time before this gap
            prev_cursor = 0.0
            for k in range(gap_start - 1, -1, -1):
                if results[k]["start"] != -1 and (k < gap_start or results[k]["start"] != results[gap_start]["start"]):
                    prev_cursor = results[k]["end"]
                    break
            realign_gap(words, transcript, char_to_word, transcript_stripped,
                        results, gap_start, gap_end, prev_cursor)

    # Interpolate any still-missing sentences
    still_failed = [i for i, r in enumerate(results) if r["start"] == -1]
    if still_failed:
        _interpolate(results, still_failed)

    return results

def _interpolate(results, failed_indices):
    n = len(results)
    # Group consecutive failures
    processed = set()
    for fi in failed_indices:
        if fi in processed:
            continue
        # Find run of consecutive failures
        run = [fi]
        j = fi + 1
        while j < n and results[j]["start"] == -1:
            run.append(j)
            j += 1
        processed.update(run)

        prev_end = next((results[k]["end"] for k in range(run[0]-1, -1, -1) if results[k]["start"] != -1), None)
        next_start = next((results[k]["start"] for k in range(run[-1]+1, n) if results[k]["start"] != -1), None)

        if prev_end is not None and next_start is not None:
            gap = next_start - prev_end
            slot = gap / (len(run) + 1)
            for k, ri in enumerate(run):
                s = round(prev_end + slot * (k + 1), 2)
                e = round(prev_end + slot * (k + 2), 2)
                results[ri]["start"], results[ri]["end"] = s, e
                print(f"  [interp] id={results[ri]['id']} {s}–{e}", flush=True)
        elif prev_end is not None:
            for k, ri in enumerate(run):
                results[ri]["start"] = round(prev_end + k * 2.0, 2)
                results[ri]["end"] = round(prev_end + (k + 1) * 2.0, 2)
        elif next_start is not None:
            offset = len(run) * 2.0
            for k, ri in enumerate(run):
                results[ri]["start"] = round(next_start - offset + k * 2.0, 2)
                results[ri]["end"] = round(next_start - offset + (k + 1) * 2.0, 2)

# ── Sentence loader ───────────────────────────────────────────────────────────

def load_by_episode(path: str) -> dict[int, list[str]]:
    """
    Parse all_sentences.txt.
    Returns {episode_number: [sentences...]}.
    Episode 0 (synopsis) is merged into episode 1.
    """
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    episodes: dict[int, list[str]] = {}
    current_ep = 0  # synopsis

    for line in lines:
        line = line.strip()
        if not line:
            continue
        m = re.match(r'^## chapter (\d+)$', line)
        if m:
            current_ep = int(m.group(1))
        else:
            episodes.setdefault(current_ep, []).append(line)

    # Merge synopsis (ep 0) into ep 1
    if 0 in episodes and 1 in episodes:
        episodes[1] = episodes.pop(0) + episodes[1]
    elif 0 in episodes:
        episodes[1] = episodes.pop(0)

    return episodes

# ── Main ──────────────────────────────────────────────────────────────────────

AUDIO_TEMPLATE = "yanerura_N1_2_ep{:02d}.mp3"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sentences", required=True)
    parser.add_argument("--audio-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="turbo")
    parser.add_argument("--episodes", default=None, help="Comma-separated episode numbers to run (e.g. 2,3,4)")
    args = parser.parse_args()

    episodes_to_run = None
    if args.episodes:
        episodes_to_run = set(int(x) for x in args.episodes.split(","))

    by_ep = load_by_episode(args.sentences)
    total_sents = sum(len(v) for v in by_ep.values())
    print(f"Loaded {total_sents} sentences across {len(by_ep)} episodes.", flush=True)
    for ep, sents in sorted(by_ep.items()):
        print(f"  Episode {ep}: {len(sents)} sentences", flush=True)

    all_results = []
    global_id = 0

    for ep_num in sorted(by_ep.keys()):
        if episodes_to_run and ep_num not in episodes_to_run:
            # Skip but advance global_id
            global_id += len(by_ep[ep_num])
            continue

        sentences = by_ep[ep_num]
        audio_file = AUDIO_TEMPLATE.format(ep_num)
        audio_path = str(Path(args.audio_dir) / audio_file)

        print(f"\n{'='*60}", flush=True)
        print(f"Episode {ep_num}: {audio_file} ({len(sentences)} sentences, ids {global_id}–{global_id+len(sentences)-1})", flush=True)
        print(f"{'='*60}", flush=True)

        words = transcribe(audio_path, args.model)
        ep_results = align_episode(words, sentences, audio_file, global_id)
        all_results.extend(ep_results)
        global_id += len(sentences)

        # Save incrementally after each episode
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  Saved {len(all_results)} total entries so far.", flush=True)

    print(f"\nDone. {len(all_results)} sentences written to {args.out}", flush=True)
    _print_typescript(all_results)

def _print_typescript(results: list[dict]):
    print("\n--- alignment.ts snippet ---")
    ep_groups: dict[str, list[dict]] = {}
    for r in results:
        ep_groups.setdefault(r["file"], []).append(r)

    for fname, entries in ep_groups.items():
        const_name = fname.replace(".mp3", "").replace("-", "_").replace(".", "_").upper()
        print(f"\nexport const {const_name}: AlignedSentence[] = [")
        for e in entries:
            print(f"  {{ id: {e['id']}, file: '{e['file']}', start: {e['start']}, end: {e['end']}, text: '{e['text']}' }},")
        print("]")

if __name__ == "__main__":
    main()
