#!/usr/bin/env python3
"""
Force-align all 8 episodes from PDF-extracted sentences against audio.
Uses chunked alignment to avoid drift on long episodes.
"""
import json, subprocess, tempfile, os, sys, ssl, math
ssl._create_default_https_context = ssl._create_unverified_context

import stable_whisper
import fugashi

AUDIO_DIR = 'public/audio'
DATA_DIR = 'scripts/data'
EP_FILES = [f'yanerura_N1_2_ep{i+1:02d}.mp3' for i in range(8)]

model = None
tagger = None

def get_model():
    global model
    if model is None:
        print('Loading stable-ts model…', flush=True)
        model = stable_whisper.load_model('turbo')
    return model

def get_tagger():
    global tagger
    if tagger is None:
        tagger = fugashi.Tagger()
    return tagger

def mecab_segment(text):
    return [tok.surface for tok in get_tagger()(text)]

def get_duration(audio_path):
    result = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
         '-of', 'csv=p=0', audio_path],
        capture_output=True, text=True, timeout=10
    )
    return float(result.stdout.strip())

def extract_clip(src, start, duration, out_path):
    subprocess.run([
        'ffmpeg', '-y', '-ss', str(start), '-t', str(duration),
        '-i', src, '-ar', '16000', '-ac', '1', out_path
    ], capture_output=True, timeout=60)

def align_text_to_clip(clip_path, sentences, offset=0.0):
    """Force-align sentences against a clip, return word tokens with absolute timestamps."""
    m = get_model()
    text = '\n'.join(sentences)
    result = m.align(clip_path, text, language='ja')

    words = []
    for seg in result.segments:
        for w in seg.words:
            words.append({
                'text': w.word.strip(),
                'start': round(w.start + offset, 3),
                'end': round(w.end + offset, 3),
            })
    return words

def map_tokens_to_sentences(sentences, all_words):
    """Map aligned tokens to MeCab-segmented sentences."""
    results = []
    tc = 0
    for sentence in sentences:
        mwords = mecab_segment(sentence)
        sent_words = []
        for mword in mwords:
            mchars = list(mword)
            if not mchars: continue
            ws = we = None
            matched = 0
            scan = tc
            while matched < len(mchars) and scan < len(all_words):
                tok = all_words[scan]
                tt = tok['text'].replace(' ', '')
                if not tt: scan += 1; continue
                ov = 0
                for ch in tt:
                    if matched + ov < len(mchars) and ch == mchars[matched + ov]:
                        ov += 1
                if ov > 0:
                    if ws is None: ws = tok['start']
                    we = tok['end']
                    matched += ov
                    scan += 1
                else:
                    scan += 1
                if scan - tc > len(mchars) + 10: break
            if ws is not None:
                sent_words.append({'text': mword, 'start': ws, 'end': we})
                tc = max(tc, scan - 1)
            else:
                pe = sent_words[-1]['end'] if sent_words else 0.0
                sent_words.append({'text': mword, 'start': pe, 'end': pe + 0.05})

        if sent_words:
            while tc < len(all_words) and all_words[tc]['end'] <= sent_words[-1]['end']:
                tc += 1

        s_start = sent_words[0]['start'] if sent_words else 0.0
        s_end = sent_words[-1]['end'] if sent_words else 0.0
        results.append({
            'start': s_start, 'end': s_end,
            'text': sentence, 'words': sent_words,
        })
    return results

def align_episode(ep_num):
    audio_path = os.path.join(AUDIO_DIR, EP_FILES[ep_num - 1])
    sent_path = os.path.join(DATA_DIR, f'ep{ep_num:02d}_pdf_sentences.txt')
    out_path = os.path.join(DATA_DIR, f'ep{ep_num:02d}_pdf_aligned.json')

    with open(sent_path) as f:
        sentences = [l.strip() for l in f if l.strip()]

    duration = get_duration(audio_path)
    print(f'\n{"="*60}')
    print(f'EP{ep_num:02d}: {len(sentences)} sentences, {duration:.0f}s audio')
    print(f'{"="*60}')

    # Determine chunk size: ~200s of audio per chunk, ~20-30 sentences
    # Estimate sentences per chunk based on audio duration and sentence count
    sents_per_chunk = max(15, len(sentences) // max(1, int(duration / 200)))

    all_results = []
    chunk_idx = 0
    s_cursor = 0

    while s_cursor < len(sentences):
        s_end = min(s_cursor + sents_per_chunk, len(sentences))
        chunk_sents = sentences[s_cursor:s_end]

        # Estimate audio range for this chunk
        # Use proportional estimation with overlap
        frac_start = s_cursor / len(sentences)
        frac_end = s_end / len(sentences)
        a_start = max(0, frac_start * duration - 15)
        a_end = min(duration, frac_end * duration + 15)

        # If we have results from previous chunk, use last sentence's end
        if all_results:
            a_start = max(0, all_results[-1]['end'] - 10)

        clip_duration = a_end - a_start
        print(f'  Chunk {chunk_idx}: sentences {s_cursor}-{s_end-1}, audio {a_start:.0f}-{a_end:.0f}s')

        clip_path = tempfile.mktemp(suffix='.wav')
        extract_clip(audio_path, a_start, clip_duration, clip_path)

        try:
            tokens = align_text_to_clip(clip_path, chunk_sents, offset=a_start)
            results = map_tokens_to_sentences(chunk_sents, tokens)

            # Validate this chunk
            bad = False
            for r in results:
                if r['start'] < 1 and s_cursor > 5:
                    bad = True
                if r['end'] - r['start'] < 0.5 and len(r['text']) > 30:
                    bad = True

            if bad:
                print(f'    WARNING: Chunk had issues, trying smaller chunks...')
                # Retry with half-size chunks
                if len(chunk_sents) > 8:
                    half = len(chunk_sents) // 2
                    s_end = s_cursor + half
                    chunk_sents = sentences[s_cursor:s_end]
                    tokens = align_text_to_clip(clip_path, chunk_sents, offset=a_start)
                    results = map_tokens_to_sentences(chunk_sents, tokens)

            all_results.extend(results)
            print(f'    -> {len(results)} sentences aligned')
        finally:
            os.unlink(clip_path)

        s_cursor = s_end
        chunk_idx += 1

    # Fix overlapping boundaries between chunks
    for i in range(1, len(all_results)):
        if all_results[i]['start'] < all_results[i-1]['end'] - 0.5:
            # Chunk boundary overlap — trim previous sentence's end
            all_results[i-1]['end'] = min(all_results[i-1]['end'], all_results[i]['start'] - 0.1)

    # Validate
    issues = 0
    prev_end = 0
    for i, r in enumerate(all_results):
        if r['start'] < prev_end - 1 and i > 0:
            issues += 1
        if r['start'] < 1 and i > 3:
            issues += 1
        prev_end = r['end']

    print(f'  Result: {len(all_results)} sentences, {issues} issues')
    print(f'  Range: {all_results[0]["start"]:.2f}s - {all_results[-1]["end"]:.2f}s')

    with open(out_path, 'w') as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f'  Saved: {out_path}')

    return issues

# Skip EP01 (already done from EP01 PDF)
total_issues = 0
for ep in range(2, 9):
    issues = align_episode(ep)
    total_issues += issues

print(f'\n{"="*60}')
print(f'DONE. Total issues across EP02-EP08: {total_issues}')
