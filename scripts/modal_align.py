"""
Ondoku force alignment API — deployed on Modal.
Multi-step upload: audio chunks → server-side alignment.

Deploy:  modal deploy scripts/modal_align.py
"""

import modal

app = modal.App("ondoku-align")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("stable-ts", "fugashi", "unidic-lite", "fastapi[standard]")
)

# Shared dict for temporary audio uploads (auto-expires)
upload_store = modal.Dict.from_name("ondoku-uploads", create_if_missing=True)


@app.cls(
    image=image,
    cpu=4,
    memory=4096,
    timeout=600,
    scaledown_window=300,
)
@modal.concurrent(max_inputs=5)
class Aligner:
    @modal.enter()
    def load_model(self):
        import stable_whisper
        import fugashi
        import ssl
        ssl._create_default_https_context = ssl._create_unverified_context
        self.model = stable_whisper.load_model("turbo")
        self.tagger = fugashi.Tagger()

    def _mecab_segment(self, text: str) -> list[str]:
        return [tok.surface for tok in self.tagger(text)]

    def _align_chunk(self, audio_path: str, sentences: list[str], offset: float = 0.0) -> list[dict]:
        full_text = "\n".join(sentences)
        result = self.model.align(audio_path, full_text, language="ja")

        all_words = []
        for seg in result.segments:
            for w in seg.words:
                all_words.append({
                    "text": w.word.strip(),
                    "start": round(w.start + offset, 3),
                    "end": round(w.end + offset, 3),
                })

        results = []
        tc = 0
        for sentence in sentences:
            mwords = self._mecab_segment(sentence)
            sent_words = []
            for mword in mwords:
                mchars = list(mword)
                if not mchars:
                    continue
                ws = we = None
                matched = 0
                scan = tc
                while matched < len(mchars) and scan < len(all_words):
                    tok = all_words[scan]
                    tt = tok["text"].replace(" ", "")
                    if not tt:
                        scan += 1
                        continue
                    ov = 0
                    for ch in tt:
                        if matched + ov < len(mchars) and ch == mchars[matched + ov]:
                            ov += 1
                    if ov > 0:
                        if ws is None:
                            ws = tok["start"]
                        we = tok["end"]
                        matched += ov
                        scan += 1
                    else:
                        scan += 1
                    if scan - tc > len(mchars) + 10:
                        break
                if ws is not None:
                    sent_words.append({"text": mword, "start": ws, "end": we})
                    tc = max(tc, scan - 1)
                else:
                    pe = sent_words[-1]["end"] if sent_words else 0.0
                    sent_words.append({"text": mword, "start": pe, "end": pe + 0.05})

            if sent_words:
                while tc < len(all_words) and all_words[tc]["end"] <= sent_words[-1]["end"]:
                    tc += 1

            s_start = sent_words[0]["start"] if sent_words else 0.0
            s_end = sent_words[-1]["end"] if sent_words else 0.0
            results.append({
                "start": s_start,
                "end": s_end,
                "text": sentence,
                "words": sent_words,
            })

        return results

    @modal.method()
    def align(self, audio_bytes: bytes, sentences: list[str]) -> list[dict]:
        import tempfile, os, subprocess

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            audio_path = f.name

        try:
            result = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "csv=p=0", audio_path],
                capture_output=True, text=True, timeout=10
            )
            duration = float(result.stdout.strip())
            print(f"Audio: {duration:.0f}s, {len(sentences)} sentences")

            if duration < 200:
                return self._align_chunk(audio_path, sentences)

            # Split into chunks — server-side, with proper overlap handling
            chunk_size = max(10, len(sentences) // max(1, int(duration / 180)))
            all_results = []
            cursor = 0

            while cursor < len(sentences):
                end = min(cursor + chunk_size, len(sentences))
                chunk_sents = sentences[cursor:end]

                frac_start = cursor / len(sentences)
                frac_end = end / len(sentences)
                a_start = max(0, frac_start * duration - 15)
                a_end = min(duration, frac_end * duration + 15)

                if all_results:
                    a_start = max(0, all_results[-1]["end"] - 10)

                clip_path = tempfile.mktemp(suffix=".wav")
                subprocess.run([
                    "ffmpeg", "-y", "-ss", str(a_start),
                    "-t", str(a_end - a_start),
                    "-i", audio_path,
                    "-ar", "16000", "-ac", "1", clip_path
                ], capture_output=True, timeout=30)

                try:
                    results = self._align_chunk(clip_path, chunk_sents, offset=a_start)
                    all_results.extend(results)
                    print(f"  Chunk {cursor}-{end-1}: {len(results)} sentences")
                finally:
                    try:
                        os.unlink(clip_path)
                    except:
                        pass

                cursor = end

            for i in range(1, len(all_results)):
                if all_results[i]["start"] < all_results[i-1]["end"] - 0.5:
                    all_results[i-1]["end"] = min(
                        all_results[i-1]["end"],
                        all_results[i]["start"] - 0.1
                    )

            return all_results
        finally:
            os.unlink(audio_path)


# ── Single endpoint for both upload and alignment ─────────────────────────────
# Uses one function/container to avoid cold start issues.

@app.function(image=image, timeout=600)
@modal.fastapi_endpoint(method="POST")
def process(data: dict):
    """
    Handles two actions via 'action' field:
    - action='upload': store an audio chunk
    - action='align': reassemble + align
    """
    import base64
    from fastapi.responses import JSONResponse

    action = data.get("action", "")

    if action == "upload":
        session_id = data.get("session_id", "")
        chunk_index = data.get("chunk_index", 0)
        audio_b64 = data.get("audio", "")
        total_chunks = data.get("total_chunks", 1)

        if not session_id or not audio_b64:
            return JSONResponse({"error": "Missing fields"}, status_code=400)

        audio_bytes = base64.b64decode(audio_b64)
        upload_store[f"{session_id}_chunk_{chunk_index}"] = audio_bytes
        upload_store[f"{session_id}_total"] = total_chunks

        print(f"Stored chunk {chunk_index}/{total_chunks}: {len(audio_bytes)/1024:.0f}KB")
        return {"ok": True, "chunk_index": chunk_index}

    elif action == "align":
        session_id = data.get("session_id", "")
        sentences = data.get("sentences", [])

        if not session_id or not sentences:
            return JSONResponse({"error": "Missing fields"}, status_code=400)

        try:
            total_chunks = upload_store.get(f"{session_id}_total", 1)

            audio_parts = []
            for i in range(total_chunks):
                key = f"{session_id}_chunk_{i}"
                chunk = upload_store.get(key)
                if chunk is None:
                    return JSONResponse({"error": f"Missing chunk {i}"}, status_code=400)
                audio_parts.append(chunk)

            audio_bytes = b"".join(audio_parts)
            print(f"Reassembled {len(audio_bytes)/1024/1024:.1f}MB, {len(sentences)} sentences")

            # Clean up
            for i in range(total_chunks):
                try: del upload_store[f"{session_id}_chunk_{i}"]
                except: pass
            try: del upload_store[f"{session_id}_total"]
            except: pass

            aligner = Aligner()
            result = aligner.align.remote(audio_bytes, sentences)
            return result

        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, status_code=500)

    elif action == "align_chunk":
        # Direct chunk alignment: audio + sentences + offset
        audio_b64 = data.get("audio", "")
        sentences = data.get("sentences", [])
        offset = float(data.get("offset", 0))

        if not audio_b64 or not sentences:
            return JSONResponse({"error": "Missing audio or sentences"}, status_code=400)

        audio_bytes = base64.b64decode(audio_b64)
        print(f"Align chunk: {len(audio_bytes)/1024:.0f}KB, {len(sentences)} sents, offset={offset:.0f}s")

        aligner = Aligner()
        result = aligner.align.remote(audio_bytes, sentences)

        # Apply offset
        if offset > 0:
            for s in result:
                s["start"] = round(s["start"] + offset, 3)
                s["end"] = round(s["end"] + offset, 3)
                for w in s.get("words", []):
                    w["start"] = round(w["start"] + offset, 3)
                    w["end"] = round(w["end"] + offset, 3)

        return result

    else:
        return JSONResponse({"error": f"Unknown action: {action}"}, status_code=400)
