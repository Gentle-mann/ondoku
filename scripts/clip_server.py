#!/usr/bin/env python3
"""
Ondoku clip server — localhost:8766
Requires: ffmpeg on PATH, local MP3 files.

Usage:
  python scripts/clip_server.py
  ONDOKU_AUDIO_DIR=/path/to/mp3s python scripts/clip_server.py

POST /clip  {"episode": 0, "start": 207.56, "end": 211.06}
GET  /      {"status": "ok"}
POST /clip_file  {"filename": "mybook.mp3", "start": 5.0, "end": 8.0}
"""
import http.server
import json
import base64
import subprocess
import tempfile
import os
import sys

import ssl
ssl._create_default_https_context = ssl._create_unverified_context

PORT = 8766

# ── Forced alignment (lazy-loaded) ───────────────────────────────────────────

_stable_model = None
_tagger = None


def _get_model(model_name: str = 'turbo'):
    global _stable_model
    if _stable_model is None:
        import stable_whisper
        print(f'[clip_server] Loading stable-ts model "{model_name}"…', flush=True)
        _stable_model = stable_whisper.load_model(model_name)
    return _stable_model


def _get_tagger():
    global _tagger
    if _tagger is None:
        import fugashi
        _tagger = fugashi.Tagger()
    return _tagger


def _mecab_segment(text: str) -> list[str]:
    return [tok.surface for tok in _get_tagger()(text)]


def _normalize(text: str) -> str:
    import unicodedata
    return unicodedata.normalize('NFKC', text.replace(' ', '').replace('\u3000', ''))


def force_align(audio_path: str, sentences: list[str], model_name: str = 'turbo') -> list[dict]:
    """Run stable-ts forced alignment, return sentences with word-level timestamps."""
    model = _get_model(model_name)
    full_text = '\n'.join(sentences)
    print(f'[clip_server] Force-aligning {len(sentences)} sentences…', flush=True)
    result = model.align(audio_path, full_text, language='ja')

    # Collect all word tokens from stable-ts
    all_words = []
    for segment in result.segments:
        for word in segment.words:
            all_words.append({
                'text': word.word.strip(),
                'start': round(word.start, 3),
                'end': round(word.end, 3),
            })
    print(f'[clip_server] Got {len(all_words)} aligned tokens', flush=True)

    # Map tokens to sentences via MeCab word segmentation
    results = []
    token_cursor = 0

    for i, sentence in enumerate(sentences):
        mecab_words = _mecab_segment(sentence)
        sentence_words = []

        for mword in mecab_words:
            mchars = list(mword)
            if not mchars:
                continue

            word_start = None
            word_end = None
            chars_to_match = len(mchars)
            matched = 0
            scan = token_cursor

            while matched < chars_to_match and scan < len(all_words):
                tok = all_words[scan]
                tok_text = tok['text'].replace(' ', '')
                if not tok_text:
                    scan += 1
                    continue
                overlap = 0
                for ch in tok_text:
                    if matched + overlap < chars_to_match and ch == mchars[matched + overlap]:
                        overlap += 1
                if overlap > 0:
                    if word_start is None:
                        word_start = tok['start']
                    word_end = tok['end']
                    matched += overlap
                    scan += 1
                else:
                    scan += 1
                if scan - token_cursor > chars_to_match + 10:
                    break

            if word_start is not None:
                sentence_words.append({'text': mword, 'start': word_start, 'end': word_end})
                token_cursor = max(token_cursor, scan - 1)
            else:
                prev_end = sentence_words[-1]['end'] if sentence_words else 0.0
                sentence_words.append({'text': mword, 'start': prev_end, 'end': prev_end + 0.05})

        if sentence_words:
            while token_cursor < len(all_words) and all_words[token_cursor]['end'] <= sentence_words[-1]['end']:
                token_cursor += 1

        sent_start = sentence_words[0]['start'] if sentence_words else 0.0
        sent_end = sentence_words[-1]['end'] if sentence_words else 0.0

        results.append({
            'start': sent_start,
            'end': sent_end,
            'text': sentence,
            'words': sentence_words,
        })

    print(f'[clip_server] Force alignment complete: {len(results)} sentences', flush=True)
    return results
PAD_START = 1.5   # seconds to extend clip before sentence start
PAD_END   = 0.3   # seconds to extend clip after sentence end
AUDIO_DIR = os.path.abspath(os.environ.get(
    'ONDOKU_AUDIO_DIR',
    os.path.expanduser('~/Projects/Audiobooks'),
))
EP_FILES = [f'yanerura_N1_2_ep{i + 1:02d}.mp3' for i in range(8)]


class ClipHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f'[clip_server] {fmt % args}', flush=True)

    def _send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps({'status': 'ok', 'audio_dir': AUDIO_DIR}).encode())

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError) as e:
            self._error(400, f'bad request: {e}')
            return

        if self.path == '/clip':
            try:
                ep = int(body['episode'])
                start = float(body['start'])
                end = float(body['end'])
            except (KeyError, ValueError) as e:
                self._error(400, f'bad request: {e}')
                return
            if ep < 0 or ep >= len(EP_FILES):
                self._error(400, f'episode out of range: {ep}')
                return
            src = os.path.join(AUDIO_DIR, EP_FILES[ep])
            if not os.path.exists(src):
                self._error(404, f'audio file not found: {src}')
                return
            start_ms = int(max(0.0, start - PAD_START) * 1000)
            end_ms = int((end + PAD_END) * 1000)
            out_filename = f'ondoku_ep{ep + 1:02d}_{start_ms}_{end_ms}.mp3'

        elif self.path == '/clip_file':
            try:
                audio_filename = os.path.basename(str(body['filename']))  # prevent path traversal
                start = float(body['start'])
                end = float(body['end'])
            except (KeyError, ValueError) as e:
                self._error(400, f'bad request: {e}')
                return
            src = os.path.join(AUDIO_DIR, audio_filename)
            if not os.path.exists(src):
                self._error(404, f'audio file not found: {audio_filename}')
                return
            start_ms = int(max(0.0, start - PAD_START) * 1000)
            end_ms = int((end + PAD_END) * 1000)
            stem = os.path.splitext(audio_filename)[0]
            out_filename = f'ondoku_{stem}_{start_ms}_{end_ms}.mp3'

        elif self.path == '/force_align':
            self._handle_force_align(body)
            return

        elif self.path == '/force_align_upload':
            self._handle_force_align_upload(body)
            return

        else:
            self._error(404, 'not found')
            return

        self._extract_clip(src, start, end, out_filename)

    def _handle_force_align_upload(self, body: dict):
        """Force-align with audio data sent as base64 (for user-uploaded books)."""
        try:
            audio_base64 = body['audio']
            sentences = body['sentences']
            model_name = body.get('model', 'turbo')
        except (KeyError, ValueError) as e:
            self._error(400, f'bad request: {e}')
            return

        # Save audio to temp file
        audio_data = base64.b64decode(audio_base64)
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            result = force_align(tmp_path, sentences, model_name)
            resp = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp)))
            self._send_cors()
            self.end_headers()
            self.wfile.write(resp)
        except Exception as e:
            self._error(500, f'force_align failed: {e}')
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def _handle_force_align(self, body: dict):
        try:
            audio_filename = os.path.basename(str(body['filename']))
            sentences = body['sentences']  # list of strings
            model_name = body.get('model', 'turbo')
        except (KeyError, ValueError) as e:
            self._error(400, f'bad request: {e}')
            return

        src = os.path.join(AUDIO_DIR, audio_filename)
        if not os.path.exists(src):
            self._error(404, f'audio file not found: {audio_filename}')
            return

        try:
            result = force_align(src, sentences, model_name)
            resp = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp)))
            self._send_cors()
            self.end_headers()
            self.wfile.write(resp)
        except Exception as e:
            self._error(500, f'force_align failed: {e}')

    def _extract_clip(self, src: str, start: float, end: float, out_filename: str):
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
            tmp_path = tmp.name

        try:
            padded_start = max(0.0, start - PAD_START)
            padded_end = end + PAD_END
            duration = max(0.1, padded_end - padded_start)

            # Try lossless copy first (fast), fall back to re-encode
            ok = self._ffmpeg([
                'ffmpeg', '-y', '-ss', str(padded_start), '-t', str(duration),
                '-i', src, '-acodec', 'copy', tmp_path
            ])
            if not ok:
                ok = self._ffmpeg([
                    'ffmpeg', '-y', '-ss', str(padded_start), '-t', str(duration),
                    '-i', src, '-acodec', 'libmp3lame', '-ab', '64k', '-ac', '1',
                    tmp_path
                ])
            if not ok:
                self._error(500, 'ffmpeg failed')
                return

            with open(tmp_path, 'rb') as f:
                data = base64.b64encode(f.read()).decode()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        resp = json.dumps({'filename': out_filename, 'data': data}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(resp)))
        self._send_cors()
        self.end_headers()
        self.wfile.write(resp)

    def _ffmpeg(self, cmd: list) -> bool:
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=20)
            return result.returncode == 0
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return False

    def _error(self, code: int, msg: str):
        body = json.dumps({'error': msg}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    audio_dir = os.path.abspath(AUDIO_DIR)
    if not os.path.isdir(audio_dir):
        print(f'Audio directory not found: {audio_dir}', file=sys.stderr)
        print('Set ONDOKU_AUDIO_DIR to the folder containing yanerura_N1_2_ep*.mp3', file=sys.stderr)
        sys.exit(1)

    found = [f for f in EP_FILES if os.path.exists(os.path.join(audio_dir, f))]
    print(f'[clip_server] audio dir: {audio_dir}  ({len(found)}/{len(EP_FILES)} episodes found)')
    print(f'[clip_server] listening on http://localhost:{PORT}')

    server = http.server.HTTPServer(('localhost', PORT), ClipHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[clip_server] stopped')
