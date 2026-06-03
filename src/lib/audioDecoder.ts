// Decode an audio File to a 16 kHz mono Float32Array for Whisper.

export async function decodeAudioTo16kHz(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer()

  // Decode with native AudioContext (any sample rate)
  const tmpCtx = new AudioContext()
  const audioBuffer = await tmpCtx.decodeAudioData(arrayBuffer)
  await tmpCtx.close()

  const TARGET_RATE = 16000
  if (audioBuffer.sampleRate === TARGET_RATE && audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0)
  }

  // Resample + downmix to mono at 16 kHz
  const duration = audioBuffer.duration
  const numFrames = Math.ceil(duration * TARGET_RATE)
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_RATE)

  const source = offlineCtx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offlineCtx.destination)
  source.start(0)

  const resampled = await offlineCtx.startRendering()
  return resampled.getChannelData(0)
}
