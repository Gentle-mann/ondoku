// Whisper ASR Web Worker — runs @xenova/transformers in a background thread.
// Messages IN:  { type: 'transcribe', audioData: Float32Array, model: string }
// Messages OUT:
//   { type: 'progress', status, file?, loaded?, total? }   — model download progress
//   { type: 'transcribing', elapsed }                       — transcription started
//   { type: 'done', chunks }                                — transcription finished
//   { type: 'error', message }

import { pipeline, env } from '@huggingface/transformers'

// Don't use local models, always download from HF Hub
env.allowLocalModels = false

type ProgressData = {
  status: string
  file?: string
  loaded?: number
  total?: number
  name?: string
}

let cachedPipe: Awaited<ReturnType<typeof pipeline>> | null = null
let cachedModel = ''

self.addEventListener('message', async (event: MessageEvent) => {
  const { audioData, model = 'Xenova/whisper-small' } = event.data as {
    audioData: Float32Array
    model: string
  }

  try {
    // Load or reuse model
    if (!cachedPipe || cachedModel !== model) {
      cachedPipe = null
      cachedPipe = await pipeline('automatic-speech-recognition', model, {
        dtype: 'fp32',
        device: 'wasm',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (data: any) => {
          self.postMessage({ type: 'progress', ...data } as ProgressData & { type: 'progress' })
        },
      })
      cachedModel = model
    }

    const start = Date.now()
    self.postMessage({ type: 'transcribing', elapsed: 0 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await (cachedPipe as any)(audioData, {
      language: 'japanese',
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    })

    // result.chunks: Array<{ text: string, timestamp: [number, number] }>
    const chunks: { text: string; timestamp: [number, number | null] }[] =
      result.chunks ?? [{ text: result.text, timestamp: [0, null] }]

    self.postMessage({ type: 'done', chunks, elapsed: Date.now() - start })
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) })
  }
})
