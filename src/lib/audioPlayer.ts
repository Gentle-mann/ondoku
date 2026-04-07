// Audio singleton — module-level, never recreated on re-render
// Safari/iOS: do NOT route through Web Audio API graph (causes choppy playback)

export interface MediaMetadata {
  title: string
  artist: string
  album?: string
  artwork?: string  // URL to cover image
}

class AudioPlayer {
  private audio: HTMLAudioElement
  private onTimeUpdate: ((time: number) => void) | null = null
  private onPlayStateChange: ((playing: boolean) => void) | null = null
  private onEnded: (() => void) | null = null
  private onDurationChange: ((duration: number) => void) | null = null
  private pendingSeek: number | null = null

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'auto'

    this.audio.addEventListener('timeupdate', () => {
      this.onTimeUpdate?.(this.audio.currentTime)
      this.updatePositionState()
    })

    this.audio.addEventListener('play', () => {
      this.onPlayStateChange?.(true)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
    })

    this.audio.addEventListener('pause', () => {
      this.onPlayStateChange?.(false)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
    })

    this.audio.addEventListener('ended', () => {
      this.onPlayStateChange?.(false)
      this.onEnded?.()
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none'
      }
    })

    this.audio.addEventListener('loadedmetadata', () => {
      this.updatePositionState()
      this.onDurationChange?.(this.audio.duration)
      if (this.pendingSeek !== null) {
        this.audio.currentTime = this.pendingSeek
        this.pendingSeek = null
        this.updatePositionState()
      }
    })

    this.setupMediaSession()
  }

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return

    navigator.mediaSession.setActionHandler('play', () => {
      this.play().catch(console.error)
    })

    navigator.mediaSession.setActionHandler('pause', () => {
      this.pause()
    })

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skip = details.seekOffset ?? 10
      this.seek(Math.max(0, this.audio.currentTime - skip))
    })

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skip = details.seekOffset ?? 10
      this.seek(Math.min(this.audio.duration, this.audio.currentTime + skip))
    })

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) {
        this.seek(details.seekTime)
      }
    })

    // previoustrack/nexttrack — will wire to episode switching in Week 3
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      this.seek(Math.max(0, this.audio.currentTime - 30))
    })

    navigator.mediaSession.setActionHandler('nexttrack', null)
  }

  private updatePositionState() {
    if (!('mediaSession' in navigator)) return
    if (!this.audio.duration || !isFinite(this.audio.duration)) return

    try {
      navigator.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate,
        position: this.audio.currentTime,
      })
    } catch {
      // setPositionState can throw if duration is not yet available
    }
  }

  setMediaMetadata(meta: MediaMetadata) {
    if (!('mediaSession' in navigator)) return

    const artwork: MediaImage[] = meta.artwork
      ? [
          { src: meta.artwork, sizes: '512x512', type: 'image/png' },
          { src: meta.artwork, sizes: '256x256', type: 'image/png' },
        ]
      : []

    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      album: meta.album ?? 'Ondoku',
      artwork,
    })
  }

  load(src: string) {
    if (this.audio.src !== src) {
      this.audio.src = src
      this.audio.load()
    }
  }

  play() {
    return this.audio.play()
  }

  pause() {
    this.audio.pause()
  }

  seek(time: number) {
    this.audio.currentTime = time
    this.updatePositionState()
  }

  /** Seek immediately if metadata is loaded, otherwise queue it for after loadedmetadata. */
  seekWhenReady(time: number) {
    if (this.audio.readyState >= 1) {
      this.seek(time)
    } else {
      this.pendingSeek = time
    }
  }

  setOnDurationChange(cb: (duration: number) => void) {
    this.onDurationChange = cb
  }

  setPlaybackRate(rate: number) {
    this.audio.playbackRate = rate
    this.updatePositionState()
  }

  get currentTime() {
    return this.audio.currentTime
  }

  get duration() {
    return this.audio.duration || 0
  }

  get paused() {
    return this.audio.paused
  }

  setOnTimeUpdate(cb: (time: number) => void) {
    this.onTimeUpdate = cb
  }

  setOnPlayStateChange(cb: (playing: boolean) => void) {
    this.onPlayStateChange = cb
  }

  setOnEnded(cb: () => void) {
    this.onEnded = cb
  }
}

export const audioPlayer = new AudioPlayer()
