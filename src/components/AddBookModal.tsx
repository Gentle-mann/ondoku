import { useRef, useState, useEffect, useCallback } from 'react'
import { X, Music, FileText, Loader2, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react'
import { addBook } from '../lib/bookLibrary'
import type { AlignedSentenceInput } from '../lib/bookLibrary'
import { pushBook } from '../lib/sync'
import { supabase } from '../lib/supabase'
import { decodeAudioTo16kHz } from '../lib/audioDecoder'
import { chunksToSentences } from '../lib/sentenceChunker'
import { forceAlignUpload } from '../lib/audioClip'
import { extractSentencesFromPdf } from '../lib/pdfExtract'
import { startBackgroundAlign } from '../lib/alignmentQueue'

interface AddBookModalProps {
  onClose: () => void
  onAdded: () => void
}

type Phase =
  | 'select'          // file selection
  | 'decoding'        // decoding audio to Float32Array
  | 'downloading'     // downloading Whisper model weights
  | 'transcribing'    // running ASR
  | 'aligning'        // force-aligning word-level timestamps
  | 'saving'          // storing to IndexedDB + OPFS
  | 'done'
  | 'error'

const MODELS = [
  { id: 'onnx-community/whisper-small', label: 'Small (244 MB) — fastest' },
  { id: 'onnx-community/whisper-medium', label: 'Medium (1.5 GB) — better' },
  { id: 'onnx-community/whisper-large-v3-turbo', label: 'Large Turbo (809 MB) — best' },
]

export function AddBookModal({ onClose, onAdded }: AddBookModalProps) {
  const [phase, setPhase] = useState<Phase>('select')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [model, setModel] = useState(MODELS[0].id)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [progress, setProgress] = useState('')     // human-readable status line
  const [downloadPct, setDownloadPct] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const audioInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)

  // Tear down worker on unmount
  useEffect(() => {
    return () => { workerRef.current?.terminate() }
  }, [])

  const MAX_AUDIO_MB = 20
  const MAX_PDF_MB = 10

  const handleAudioFile = (file: File) => {
    if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
      setErrorMsg(`Audio file too large (${(file.size / 1024 / 1024).toFixed(0)}MB). Max ${MAX_AUDIO_MB}MB.`)
      setPhase('error')
      return
    }
    setAudioFile(file)
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''))
  }

  const handlePdfFile = (file: File) => {
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      setErrorMsg(`PDF too large (${(file.size / 1024 / 1024).toFixed(0)}MB). Max ${MAX_PDF_MB}MB.`)
      setPhase('error')
      return
    }
    setPdfFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = Array.from(e.dataTransfer.files).find(
      (f) => f.type.startsWith('audio/') || /\.(mp3|m4a|ogg|wav|flac)$/i.test(f.name)
    )
    if (file) handleAudioFile(file)
  }

  const handlePdfAlign = useCallback(async () => {
    if (!audioFile || !pdfFile) return

    try {
      // Step 1: Extract text from PDF
      setPhase('decoding')
      setProgress('Extracting text from PDF…')
      const pdfSentences = await extractSentencesFromPdf(pdfFile)
      if (pdfSentences.length === 0) {
        setErrorMsg('No sentences found in PDF')
        setPhase('error')
        return
      }

      // Step 2: Save immediately with proportional timing (usable right away)
      setPhase('saving')
      setProgress('Saving book…')

      // Estimate total duration from audio file size (~128kbps)
      const estimatedDuration = (audioFile.size / (128 * 1024 / 8))
      const totalChars = pdfSentences.reduce((sum, s) => sum + s.length, 0)
      let t = 0
      const sentences: AlignedSentenceInput[] = pdfSentences.map((text) => {
        const frac = text.length / totalChars
        const dur = estimatedDuration * frac
        const start = Math.round(t * 100) / 100
        const end = Math.round((t + dur) * 100) / 100
        t += dur
        return { start, end, text }
      })

      const meta = await addBook(
        { title: title || pdfFile.name.replace(/\.[^.]+$/, ''), author, sentenceCount: sentences.length },
        sentences,
        audioFile,
      )
      const session = await supabase?.auth.getSession()
      if (session?.data.session?.user) {
        pushBook(meta, sentences).catch(console.error)
      }

      // Step 3: Start force alignment in background — upgrades to word-level
      startBackgroundAlign(meta.id, audioFile, meta.audioFilename, pdfSentences)

      setPhase('done')
      setTimeout(() => { onAdded(); onClose() }, 800)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [audioFile, pdfFile, title, author, onAdded, onClose])

  const handleTranscribe = useCallback(async () => {
    if (!audioFile) return

    setPhase('decoding')
    setProgress('Decoding audio…')
    setDownloadPct(null)

    let audioData: Float32Array
    try {
      audioData = await decodeAudioTo16kHz(audioFile)
    } catch (err) {
      setErrorMsg(`Audio decode failed: ${err}`)
      setPhase('error')
      return
    }

    // Spawn worker
    const worker = new Worker(
      new URL('../workers/whisper.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    worker.addEventListener('error', (e) => {
      setErrorMsg(`Worker error: ${e.message || 'Failed to load Whisper worker'}`)
      setPhase('error')
      worker.terminate()
      workerRef.current = null
    })

    worker.addEventListener('message', async (event) => {
      const msg = event.data

      if (msg.type === 'progress') {
        if (msg.status === 'download') {
          setPhase('downloading')
          if (msg.total) {
            const pct = Math.round((msg.loaded / msg.total) * 100)
            setDownloadPct(pct)
            const mb = (msg.total / 1024 / 1024).toFixed(0)
            setProgress(`Downloading model… ${pct}% of ${mb} MB`)
          } else {
            setProgress(`Downloading ${msg.file?.split('/').pop() ?? 'model'}…`)
          }
        } else if (msg.status === 'initiate' || msg.status === 'loading') {
          setProgress('Loading model…')
          setDownloadPct(null)
        } else if (msg.status === 'ready') {
          setProgress('Model ready')
        }
        return
      }

      if (msg.type === 'transcribing') {
        setPhase('transcribing')
        setProgress('Transcribing… this may take a few minutes for long audio')
        setDownloadPct(null)
        return
      }

      if (msg.type === 'done') {
        let sentences: AlignedSentenceInput[] = chunksToSentences(msg.chunks)
        worker.terminate()
        workerRef.current = null

        // Try force-align for word-level timestamps (silent best-effort)
        try {
          const aligned = await forceAlignUpload(
            audioFile,
            sentences.map((s: AlignedSentenceInput) => s.text),
          )
          if (aligned) {
            sentences = aligned.map((s: typeof aligned[number]) => ({
              start: s.start,
              end: s.end,
              text: s.text,
              words: s.words,
            }))
          }
        } catch {
          // Fallback to sentence-level — no server needed
        }

        setPhase('saving')
        setProgress('Saving to device…')
        try {
          const meta = await addBook({ title: title || audioFile.name, author, sentenceCount: sentences.length }, sentences, audioFile)
          // Push to cloud if signed in (best-effort — don't block on failure)
          const session = await supabase?.auth.getSession()
          if (session?.data.session?.user) {
            pushBook(meta, sentences).catch(console.error)
          }
          setPhase('done')
          setTimeout(() => { onAdded(); onClose() }, 1200)
        } catch (err) {
          setErrorMsg(String(err))
          setPhase('error')
        }
        return
      }

      if (msg.type === 'error') {
        setErrorMsg(msg.message)
        setPhase('error')
        worker.terminate()
        workerRef.current = null
      }
    })

    // Transfer buffer to worker (zero-copy)
    worker.postMessage({ audioData, model }, [audioData.buffer])
  }, [audioFile, title, author, model, onAdded, onClose])

  const isRunning = phase === 'decoding' || phase === 'downloading' || phase === 'transcribing' || phase === 'aligning' || phase === 'saving'
  const selectedModel = MODELS.find((m) => m.id === model) ?? MODELS[0]

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-50" onClick={isRunning ? undefined : onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-[20px] flex flex-col"
        style={{ backgroundColor: '#141414', maxHeight: '88dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="font-sans text-[16px] font-semibold text-foreground">Add Book</h2>
          {!isRunning && (
            <button onClick={onClose} className="p-1 active:opacity-60">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
        </div>

        <div className="px-5 pb-8 overflow-y-auto flex-1">
          {/* Done */}
          {phase === 'done' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <CheckCircle className="w-12 h-12" style={{ color: '#4CAF50' }} />
              <p className="font-sans text-sm" style={{ color: '#4CAF50' }}>Book added!</p>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <div className="flex flex-col items-center py-8 gap-4">
              <AlertCircle className="w-10 h-10" style={{ color: '#ef4444' }} />
              <p className="font-sans text-sm text-center" style={{ color: '#ef4444' }}>{errorMsg}</p>
              <button
                onClick={() => setPhase('select')}
                className="font-sans text-sm text-accent underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* In progress */}
          {isRunning && (
            <div className="flex flex-col items-center py-10 gap-5">
              <Loader2 className="w-10 h-10 animate-spin text-accent" />

              <p className="font-sans text-sm text-center text-muted-foreground max-w-xs">
                {progress}
              </p>

              {/* Download bar */}
              {downloadPct !== null && (
                <div className="w-full max-w-xs">
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${downloadPct}%`, backgroundColor: '#C8A96E' }}
                    />
                  </div>
                </div>
              )}

              {phase === 'transcribing' && (
                <p className="font-sans text-[11px] text-muted-foreground text-center max-w-xs">
                  First run downloads the model (~{selectedModel.label.match(/\d+ MB|\d+\.\d+ GB/)?.[0] ?? '?'}). Subsequent runs use the cached version.
                </p>
              )}
            </div>
          )}

          {/* File selection form */}
          {phase === 'select' && (
            <>
              {/* Drop zone */}
              <div
                className="border border-dashed rounded-xl p-5 mb-4 text-center"
                style={{ borderColor: '#333' }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <p className="font-sans text-sm text-muted-foreground">
                  Drop MP3 / M4A here, or
                </p>
                <button
                  onClick={() => audioInputRef.current?.click()}
                  className="font-sans text-sm text-accent underline mt-1"
                >
                  select file
                </button>
              </div>

              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleAudioFile(e.target.files[0])}
              />

              {/* Selected file */}
              {audioFile && (
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4"
                  style={{ backgroundColor: '#1a2a1a', border: '1px solid #2a4a2a' }}
                >
                  <Music className="w-5 h-5 shrink-0" style={{ color: '#4CAF50' }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-sans text-sm text-foreground truncate">{audioFile.name}</p>
                    <p className="font-sans text-[11px] text-muted-foreground">
                      {(audioFile.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  <button onClick={() => setAudioFile(null)} className="active:opacity-60">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              )}

              {/* PDF file (optional) */}
              <div className="mb-4">
                <p className="font-sans text-[11px] text-muted-foreground mb-1.5">
                  PDF eBook (optional — for word-level accuracy)
                </p>
                {pdfFile ? (
                  <div
                    className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{ backgroundColor: '#1a1a2a', border: '1px solid #2a2a4a' }}
                  >
                    <FileText className="w-5 h-5 shrink-0" style={{ color: '#C8A96E' }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-sans text-sm text-foreground truncate">{pdfFile.name}</p>
                      <p className="font-sans text-[11px] text-muted-foreground">
                        {(pdfFile.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <button onClick={() => setPdfFile(null)} className="active:opacity-60">
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => pdfInputRef.current?.click()}
                    className="w-full px-4 py-2.5 rounded-xl font-sans text-sm text-muted-foreground text-left"
                    style={{ backgroundColor: '#1A1A1A', border: '1px dashed #333' }}
                  >
                    + Add PDF for precise word highlighting
                  </button>
                )}
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handlePdfFile(e.target.files[0])}
                />
              </div>

              {/* Metadata */}
              <div className="space-y-3 mb-4">
                <input
                  className="w-full px-4 py-2.5 rounded-xl font-sans text-sm bg-secondary text-foreground outline-none"
                  placeholder="Title (optional)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <input
                  className="w-full px-4 py-2.5 rounded-xl font-sans text-sm bg-secondary text-foreground outline-none"
                  placeholder="Author (optional)"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>

              {/* Model selector — only show when no PDF */}
              {!pdfFile && (
                <div className="mb-5">
                  <p className="font-sans text-[11px] text-muted-foreground mb-1.5">Whisper model</p>
                  <div className="relative">
                    <button
                      onClick={() => setShowModelPicker(!showModelPicker)}
                      className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl font-sans text-sm text-foreground"
                      style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}
                    >
                      <span>{selectedModel.label}</span>
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {showModelPicker && (
                      <div
                        className="absolute bottom-full left-0 right-0 mb-1 rounded-xl overflow-hidden z-10"
                        style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}
                      >
                        {MODELS.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => { setModel(m.id); setShowModelPicker(false) }}
                            className="w-full text-left px-4 py-3 font-sans text-sm transition-colors hover:bg-white/5"
                            style={{ color: m.id === model ? '#C8A96E' : '#ccc' }}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="font-sans text-[11px] text-muted-foreground mt-1.5">
                    Downloaded once, cached in browser. Small is good enough for most books.
                  </p>
                </div>
              )}

              <button
                onClick={pdfFile ? handlePdfAlign : handleTranscribe}
                disabled={!audioFile}
                className="w-full py-3 rounded-xl font-sans text-sm font-medium transition-opacity"
                style={{
                  backgroundColor: audioFile ? '#C8A96E' : '#2a2a2a',
                  color: audioFile ? '#111' : '#555',
                }}
              >
                {pdfFile ? 'Align & Add' : 'Transcribe & Add'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
