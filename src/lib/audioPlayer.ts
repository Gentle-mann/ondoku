// Audio singleton — module-level, never recreated on re-render
// Safari/iOS: do NOT route through Web Audio API graph (causes choppy playback)

export interface MediaMetadata {
  title: string
  artist: string
  album?: string
  artwork?: string  // URL to cover image
}

export type PauseReason = 'user' | 'intensive' | 'cleanup' | 'preview' | 'media-session' | 'sleep-timer'

class AudioPlayer {
  private audio: HTMLAudioElement
  private onTimeUpdate: ((time: number) => void) | null = null
  private onPlayStateChange: ((playing: boolean) => void) | null = null
  private onEnded: (() => void) | null = null
  private onDurationChange: ((duration: number) => void) | null = null
  private pendingSeek: number | null = null
  private pendingPlay = false
  private rafId: number | null = null
  private lastEmittedTime = -1
  private lastIntentionalPauseAt = 0
  private lastPauseReason: PauseReason | null = null
  // Set to true by load() so seekWhenReady never tries to seek into a
  // not-yet-loaded src (some browsers keep readyState >= 1 from cache
  // across a load() call, causing an immediate seek that silently fails).
  private justLoaded = false

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.playbackRate = parseFloat(localStorage.getItem('ondoku_speed') ?? '1.0') || 1.0

    this.audio.addEventListener('timeupdate', () => {
      this.emitTimeUpdate()
      this.updatePositionState()
    })

    this.audio.addEventListener('play', () => {
      this.lastPauseReason = null
      this.startPrecisionClock()
      this.onPlayStateChange?.(true)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
    })

    this.audio.addEventListener('pause', () => {
      this.stopPrecisionClock()
      this.emitTimeUpdate(true)
      this.onPlayStateChange?.(false)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
    })

    this.audio.addEventListener('ended', () => {
      this.stopPrecisionClock()
      this.emitTimeUpdate(true)
      this.onPlayStateChange?.(false)
      this.onEnded?.()
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none'
      }
    })

    this.audio.addEventListener('loadedmetadata', () => {
      this.justLoaded = false
      this.updatePositionState()
      this.onDurationChange?.(this.audio.duration)
      if (this.pendingSeek !== null) {
        this.audio.currentTime = this.pendingSeek
        this.pendingSeek = null
        this.emitTimeUpdate(true)
        this.updatePositionState()
      }
      // Play AFTER seek so we start at the right position, not time=0
      if (this.pendingPlay) {
        this.pendingPlay = false
        this.audio.play().catch(console.error)
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
      this.pause('media-session')
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

  private emitTimeUpdate(force = false) {
    const time = this.audio.currentTime
    if (!force && Math.abs(time - this.lastEmittedTime) < 0.012) return
    this.lastEmittedTime = time
    this.onTimeUpdate?.(time)
  }

  private startPrecisionClock() {
    if (this.rafId !== null) return

    const tick = () => {
      this.emitTimeUpdate()
      if (!this.audio.paused && !this.audio.ended) {
        this.rafId = requestAnimationFrame(tick)
      } else {
        this.rafId = null
      }
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private stopPrecisionClock() {
    if (this.rafId === null) return
    cancelAnimationFrame(this.rafId)
    this.rafId = null
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
      this.pendingSeek = null   // discard any seek queued for the old src
      this.pendingPlay = false
      this.justLoaded = true
      this.audio.src = src
      this.audio.load()
      // Reapply stored playback rate — some browsers reset it on load()
      this.audio.playbackRate = parseFloat(localStorage.getItem('ondoku_speed') ?? '1.0') || 1.0
    }
  }

  play() {
    return this.audio.play()
  }

  pause(reason: PauseReason = 'user') {
    this.lastIntentionalPauseAt = performance.now()
    this.lastPauseReason = reason
    this.audio.pause()
  }

  seek(time: number) {
    this.audio.currentTime = time
    this.emitTimeUpdate(true)
    this.updatePositionState()
  }

  /**
   * Seek immediately if this is a same-src seek and metadata is available.
   * After load() (new src), always queue for loadedmetadata — never seek
   * into a not-yet-loaded source even if readyState looks ready from cache.
   */
  seekWhenReady(time: number) {
    if (!this.justLoaded && this.audio.readyState >= 1) {
      this.seek(time)
    } else {
      this.pendingSeek = time
    }
  }

  /**
   * Start playing as soon as the current src is ready.
   * If we're mid-load (justLoaded), delays until after loadedmetadata
   * so playback starts at the seeked position, not at time=0.
   */
  playWhenReady() {
    if (!this.justLoaded && this.audio.readyState >= 3) {
      this.audio.play().catch(console.error)
    } else {
      this.pendingPlay = true
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

  get ended() {
    return this.audio.ended
  }

  wasRecentlyPausedIntentionally(windowMs = 1000) {
    return performance.now() - this.lastIntentionalPauseAt <= windowMs
  }

  getLastPauseReason() {
    return this.lastPauseReason
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

  getAudioSrc(): string | null {
    return this.audio.src || null
  }
}

export const audioPlayer = new AudioPlayer()
