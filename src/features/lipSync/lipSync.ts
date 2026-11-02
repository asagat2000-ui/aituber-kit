import { logger } from '@/lib/logger'
import { LipSyncAnalyzeResult } from './lipSyncAnalyzeResult'
import {
  registerAudioContext,
  getGestureCount,
  getReplaceCount,
  getSharedAudioContext,
} from './audioUnlock'

const TIME_DOMAIN_DATA_LENGTH = 2048

/**
 * iOS の音声セッションを「再生」に切り替えるための無音WAV。
 * これを <audio> で一度鳴らすと、サイレントスイッチが下でも Web Audio が鳴るようになる。
 */
const SILENT_WAV_URI =
  'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YVAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='

/** resume() が返らない環境（iOS）で固まらないための待ち時間 */
const RESUME_TIMEOUT_MS = 150
/** 音が出ないまま発話キューが詰まるのを防ぐ */
const PLAYBACK_GIVEUP_MS = 15000

export class LipSync {
  public audio: AudioContext
  public readonly analyser: AnalyserNode
  public readonly timeDomainData: Float32Array
  private userInteracted: boolean = false
  private waitingForInteraction: boolean = false
  private iosSessionUnlocked = false
  private unlockBanner: HTMLDivElement | null = null
  private pendingPlaybacks: Array<() => void> = []
  private forceStart: boolean = false
  private currentSource: AudioBufferSourceNode | null = null
  private currentStreamReader: ReadableStreamDefaultReader<Uint8Array> | null =
    null
  private currentStreamSources = new Set<AudioBufferSourceNode>()
  private streamPlaybackGeneration = 0

  public constructor(audio: AudioContext, options?: { forceStart?: boolean }) {
    this.audio = audio
    this.analyser = audio.createAnalyser()
    this.timeDomainData = new Float32Array(TIME_DOMAIN_DATA_LENGTH)
    this.forceStart = options?.forceStart || false

    // iOS Safari は「ユーザー操作の外で作った AudioContext」を suspended のまま維持し、
    // resume() も黙って失敗する。forceStart でもリスナーは必ず登録する。
    this.setupUserInteractionDetection()

    if (this.forceStart) {
      this.userInteracted = true
      this.tryResumeAudio().catch((error) => {
        logger.warn('Failed to force resume AudioContext:', error)
      })
    }

    this.audio.onstatechange = () => this.updateBanner()
    registerAudioContext({
      get: () => this.audio,
      onReplace: (ctx) => {
        this.audio = ctx
        this.audio.onstatechange = () => this.updateBanner()
      },
    })
    this.updateBanner()
  }

  /**
   * close 済みの Context を作り直す。
   * iOS では close した Context は復帰できないため、作り直すしかない。
   */
  private recreateAudioContext(): void {
    try {
      this.stopCurrentPlayback()
    } catch {
      // 停止できなくても作り直しは続行する
    }
    try {
      this.audio = getSharedAudioContext(true)
      this.audio.onstatechange = () => this.updateBanner()
      logger.log('AudioContext recreated:', this.audio.state)
    } catch (error) {
      logger.error('Failed to recreate AudioContext:', error)
    }
  }

  /** 現在の AudioContext の状態（診断用） */
  public getAudioState(): string {
    return this.audio.state
  }

  /**
   * iOS の音声セッションを「再生」に切り替える。
   * 無音を <audio> で鳴らすことで、サイレントスイッチが下でも
   * Web Audio がミュートされなくなる。
   */
  private unlockIosAudioSession(): void {
    if (this.iosSessionUnlocked) return
    // テスト環境（jsdom）には Audio 実装が無いため触らない
    if (typeof window === 'undefined' || typeof window.Audio !== 'function') {
      return
    }
    this.iosSessionUnlocked = true
    try {
      const el = new Audio()
      el.setAttribute('playsinline', 'true')
      el.setAttribute('webkit-playsinline', 'true')
      el.src = SILENT_WAV_URI
      el.volume = 0.01
      const played = el.play()
      if (played && typeof played.catch === 'function') {
        played.catch(() => {
          // 失敗したら次回のタップで再試行できるように戻す
          this.iosSessionUnlocked = false
        })
      }
    } catch (error) {
      this.iosSessionUnlocked = false
      logger.warn('Failed to unlock iOS audio session:', error)
    }
  }

  /** 音が出ない状態のときだけ画面下に案内を出す */
  private updateBanner(): void {
    if (typeof document === 'undefined') return
    const running = this.audio.state === 'running'
    if (running) {
      if (this.unlockBanner) {
        this.unlockBanner.remove()
        this.unlockBanner = null
      }
      return
    }
    if (this.unlockBanner) return
    const el = document.createElement('div')
    const rate = this.audio.sampleRate
    el.textContent =
      `音が止まっています。画面をタップしてください` +
      `（${this.audio.state} / ${rate}Hz / タップ${getGestureCount()}回 / 再生成${getReplaceCount()}回）`
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:16px',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'background:rgba(20,20,20,.88)',
      'color:#fff',
      'font-size:14px',
      'line-height:1.4',
      'padding:8px 14px',
      'border-radius:999px',
      'pointer-events:none',
      'box-shadow:0 2px 8px rgba(0,0,0,.3)',
    ].join(';')
    document.body.appendChild(el)
    this.unlockBanner = el
  }

  // AudioContextの再開を試みるメソッド
  /**
   * AudioContext の再開を試みる。
   * 戻り値が true なら「鳴らせる状態になった」と判断してよい。
   * iOS は操作なしだと resume() が解決しないため、必ずタイムアウトを挟む。
   */
  private async tryResumeAudio(): Promise<boolean> {
    if (this.audio.state === 'closed') {
      this.recreateAudioContext()
    }
    if (this.getAudioState() === 'running') return true

    let resumed = false
    try {
      await Promise.race([
        this.audio
          .resume()
          .then(() => {
            resumed = true
          })
          .catch((error) => {
            logger.warn('AudioContext resume rejected:', error)
          }),
        new Promise<void>((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS)),
      ])
    } catch (error) {
      logger.error('Failed to resume AudioContext:', error)
      return false
    }

    // resume() が解決した＝ユーザー操作の文脈で解除できた、とみなす。
    // （環境によっては state の文字列が即座に変わらないことがある）
    // 操作後に resume が解決したなら鳴らせると判断する（forceStart 時の初回は除く）
    if (
      this.getAudioState() === 'running' ||
      (resumed && this.userInteracted)
    ) {
      logger.log('AudioContext resumed successfully')
      this.processPendingPlaybacks()
      this.updateBanner()
      return true
    }

    this.updateBanner()
    return false
  }

  private setupUserInteractionDetection(): void {
    if (typeof window === 'undefined') return

    const interactionEvents = ['pointerdown', 'touchstart', 'click', 'keydown']

    // iOS はバックグラウンド復帰などで再び suspended に戻るため、
    // 一度きりにせず毎回試す（処理は軽い）。
    const handleInteraction = () => {
      this.userInteracted = true
      this.unlockIosAudioSession()
      void this.tryResumeAudio()
    }

    interactionEvents.forEach((eventType) => {
      window.addEventListener(eventType, handleInteraction, true)
    })
  }

  private processPendingPlaybacks(): void {
    // ユーザー操作を契機に呼ばれる。ここで流さないと発話キューが詰まるため、
    // 状態に関わらず保留分を解放する（実際に鳴るかは resume の成否に従う）。
    if (this.pendingPlaybacks.length > 0) {
      logger.log(
        `Processing ${this.pendingPlaybacks.length} pending audio playbacks`
      )
      const playbacks = [...this.pendingPlaybacks]
      this.pendingPlaybacks = []
      playbacks.forEach((playback) => playback())
    }
  }

  private async ensureAudioContextReady(): Promise<boolean> {
    if (this.audio.state === 'running') return true

    // まだユーザー操作が無いうちは resume を試みない。
    // iOS ではこの段階の resume() が永久に解決しないため、待つだけ無駄になる。
    if (!this.userInteracted && !this.forceStart) {
      this.waitingForInteraction = true
      this.updateBanner()
      logger.warn('AudioContext cannot start: waiting for user interaction')
      return false
    }

    const resumed = await this.tryResumeAudio()
    if (resumed) return true

    // 実際には鳴らないのに true を返すと、無音のまま「再生済み」になる。
    // ここは必ず false を返し、保留キューに積む。
    this.waitingForInteraction = true
    this.updateBanner()
    logger.warn('AudioContext is not running: waiting for user gesture')
    return false
  }

  // forceStart設定を動的に変更するメソッドを追加
  public setForceStart(enable: boolean): void {
    this.forceStart = enable
    if (enable && !this.userInteracted) {
      this.userInteracted = true
      this.tryResumeAudio()
    }
  }

  public update(): LipSyncAnalyzeResult {
    // forceStartが有効でAudioContextが準備できていない場合は再開を試みる
    if (this.forceStart && this.audio.state === 'suspended') {
      this.tryResumeAudio()
    }

    this.analyser.getFloatTimeDomainData(this.timeDomainData)

    let volume = 0.0
    for (let i = 0; i < TIME_DOMAIN_DATA_LENGTH; i++) {
      volume = Math.max(volume, Math.abs(this.timeDomainData[i]))
    }

    // cook
    volume = 1 / (1 + Math.exp(-45 * volume + 5))
    if (volume < 0.1) volume = 0

    return {
      volume,
    }
  }

  public async playFromArrayBuffer(
    buffer: ArrayBuffer,
    onEnded?: () => void,
    isNeedDecode: boolean = true,
    sampleRate: number = 24000,
    onStarted?: () => void
  ) {
    const queuedGeneration = this.streamPlaybackGeneration
    // AudioContextが準備できているか確認
    const isReady = await this.ensureAudioContextReady()

    if (!isReady) {
      // ユーザーインタラクションを待つ
      let settled = false
      const retry = () => {
        settled = true
        if (queuedGeneration !== this.streamPlaybackGeneration) return
        this.playFromArrayBuffer(
          buffer,
          onEnded,
          isNeedDecode,
          sampleRate,
          onStarted
        )
      }
      this.pendingPlaybacks.push(retry)
      // 音が出ないまま発話キューが永久に詰まるのを防ぐ
      setTimeout(() => {
        if (settled) return
        const index = this.pendingPlaybacks.indexOf(retry)
        if (index >= 0) this.pendingPlaybacks.splice(index, 1)
        logger.warn('AudioContext never resumed: skipping this playback')
        this.updateBanner()
        onEnded?.()
      }, PLAYBACK_GIVEUP_MS)
      return
    }

    try {
      // バッファの型チェック
      if (!(buffer instanceof ArrayBuffer)) {
        throw new Error('The input buffer is not in ArrayBuffer format')
      }

      // バッファの長さチェック
      if (buffer.byteLength === 0) {
        throw new Error('The input buffer is empty')
      }

      let audioBuffer: AudioBuffer

      if (!isNeedDecode) {
        // PCM16形式の場合
        const pcmData = new Int16Array(buffer)

        const floatData = new Float32Array(pcmData.length)
        for (let i = 0; i < pcmData.length; i++) {
          floatData[i] =
            pcmData[i] < 0 ? pcmData[i] / 32768.0 : pcmData[i] / 32767.0
        }

        audioBuffer = this.audio.createBuffer(1, floatData.length, sampleRate)
        audioBuffer.getChannelData(0).set(floatData)
      } else {
        // 通常の圧縮音声ファイルの場合
        try {
          audioBuffer = await this.audio.decodeAudioData(buffer)
        } catch (decodeError) {
          logger.error('Failed to decode audio data:', decodeError)
          throw new Error('The audio data could not be decoded')
        }
      }

      const bufferSource = this.audio.createBufferSource()
      // 再生中ソースを保持し、終了時にクリア
      this.currentSource = bufferSource
      bufferSource.buffer = audioBuffer

      bufferSource.connect(this.audio.destination)
      bufferSource.connect(this.analyser)
      bufferSource.start()
      onStarted?.()
      if (onEnded) {
        bufferSource.addEventListener('ended', onEnded)
      }

      // 再生終了後にクリア
      bufferSource.onended = () => {
        if (this.currentSource === bufferSource) this.currentSource = null
        onEnded?.()
      }
    } catch (error) {
      logger.error('Failed to play audio:', error)
      if (onEnded) {
        onEnded()
      }
      // ensure currentSource cleared on error
      this.currentSource = null
    }
  }

  /**
   * ヘッダーなしlittle-endian PCM16を読みながら100ms単位でWeb Audioへ予約する。
   * 全レスポンスを待たず最初のチャンクから発話を始め、同じAnalyserNodeで
   * 既存のVRMリップシンクを継続する。
   */
  public async playPcm16Stream(
    stream: ReadableStream<Uint8Array>,
    onEnded?: () => void,
    sampleRate: number = 16000,
    onStarted?: () => void
  ): Promise<void> {
    const queuedGeneration = this.streamPlaybackGeneration
    const isReady = await this.ensureAudioContextReady()
    if (!isReady) {
      await new Promise<void>((resolve) => {
        this.pendingPlaybacks.push(() => {
          if (queuedGeneration !== this.streamPlaybackGeneration) {
            void stream
              .cancel('playback superseded')
              .catch(() => {})
              .finally(resolve)
            return
          }
          void this.playPcm16Stream(
            stream,
            onEnded,
            sampleRate,
            onStarted
          ).finally(resolve)
        })
      })
      return
    }

    this.stopCurrentPlayback()
    const generation = this.streamPlaybackGeneration
    const reader = stream.getReader()
    this.currentStreamReader = reader

    // 100msはネットワークチャンクの細分化を抑えつつ、初動を遅らせすぎない。
    const bytesPerFrame = Math.max(2, Math.floor(sampleRate / 10) * 2)
    let pending = new Uint8Array(0)
    let nextStartAt = this.audio.currentTime + 0.03
    let lastSourceEnded: Promise<void> = Promise.resolve()
    const scheduledSources: Array<{
      duration: number
      ended: Promise<void>
    }> = []
    let scheduledDuration = 0
    let playbackStarted = false
    let completed = false

    // 100msフレームを最大約1.5秒分だけ予約し、全音声の先読みを避ける。
    const maxReadAheadSeconds = 1.5

    const waitForReadAheadCapacity = async () => {
      while (
        generation === this.streamPlaybackGeneration &&
        scheduledDuration >= maxReadAheadSeconds &&
        scheduledSources.length > 0
      ) {
        const nextSource = scheduledSources.shift()
        if (!nextSource) break
        await nextSource.ended
        scheduledDuration = Math.max(0, scheduledDuration - nextSource.duration)
      }
    }

    const finish = () => {
      if (completed) return
      completed = true
      onEnded?.()
    }

    const append = (left: Uint8Array, right: Uint8Array) => {
      const combined = new Uint8Array(left.byteLength + right.byteLength)
      combined.set(left)
      combined.set(right, left.byteLength)
      return combined
    }

    const schedule = (pcmBytes: Uint8Array) => {
      if (
        generation !== this.streamPlaybackGeneration ||
        pcmBytes.byteLength < 2
      ) {
        return
      }

      const sampleCount = Math.floor(pcmBytes.byteLength / 2)
      const floatData = new Float32Array(sampleCount)
      const view = new DataView(
        pcmBytes.buffer,
        pcmBytes.byteOffset,
        sampleCount * 2
      )
      for (let index = 0; index < sampleCount; index++) {
        const sample = view.getInt16(index * 2, true)
        floatData[index] = sample < 0 ? sample / 32768 : sample / 32767
      }

      const audioBuffer = this.audio.createBuffer(1, sampleCount, sampleRate)
      audioBuffer.getChannelData(0).set(floatData)
      const source = this.audio.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.audio.destination)
      source.connect(this.analyser)
      this.currentStreamSources.add(source)

      const sourceEnded = new Promise<void>((resolve) => {
        source.onended = () => {
          this.currentStreamSources.delete(source)
          resolve()
        }
      })
      lastSourceEnded = sourceEnded
      scheduledSources.push({
        duration: audioBuffer.duration,
        ended: sourceEnded,
      })
      scheduledDuration += audioBuffer.duration

      const startAt = Math.max(nextStartAt, this.audio.currentTime + 0.01)
      source.start(startAt)
      nextStartAt = startAt + audioBuffer.duration
      if (!playbackStarted) {
        playbackStarted = true
        onStarted?.()
      }
    }

    try {
      while (generation === this.streamPlaybackGeneration) {
        await waitForReadAheadCapacity()
        if (generation !== this.streamPlaybackGeneration) break

        const { done, value } = await reader.read()
        if (done) break
        if (!value?.byteLength) continue

        pending = append(pending, value)
        while (pending.byteLength >= bytesPerFrame) {
          await waitForReadAheadCapacity()
          if (generation !== this.streamPlaybackGeneration) break
          schedule(pending.slice(0, bytesPerFrame))
          pending = pending.slice(bytesPerFrame)
        }
      }

      if (
        generation === this.streamPlaybackGeneration &&
        pending.byteLength >= 2
      ) {
        await waitForReadAheadCapacity()
        schedule(
          pending.slice(0, pending.byteLength - (pending.byteLength % 2))
        )
      }
      await lastSourceEnded
    } catch (error) {
      if (generation === this.streamPlaybackGeneration) {
        logger.error('Failed to play PCM16 stream:', error)
      }
    } finally {
      if (this.currentStreamReader === reader) {
        this.currentStreamReader = null
      }
      reader.releaseLock()
      finish()
    }
  }

  public async playFromURL(url: string, onEnded?: () => void) {
    try {
      const res = await fetch(url)
      const buffer = await res.arrayBuffer()
      await this.playFromArrayBuffer(buffer, onEnded)
    } catch (error) {
      logger.error('Failed to fetch audio from URL:', error)
      if (onEnded) {
        onEnded()
      }
    }
  }

  // PCM16形式かどうかを判断するメソッド
  private detectPCM16(buffer: ArrayBuffer): boolean {
    // バッファサイズが偶数であることを確認
    if (buffer.byteLength % 2 !== 0) {
      return false
    }

    // サンプルデータの範囲をチェック
    const int16Array = new Int16Array(buffer)
    let isWithinRange = true
    for (let i = 0; i < Math.min(1000, int16Array.length); i++) {
      if (int16Array[i] < -32768 || int16Array[i] > 32767) {
        isWithinRange = false
        break
      }
    }

    // データの分布を簡単にチェック
    let nonZeroCount = 0
    for (let i = 0; i < Math.min(1000, int16Array.length); i++) {
      if (int16Array[i] !== 0) {
        nonZeroCount++
      }
    }

    // 少なくともデータの10%が非ゼロであることを確認
    const hasReasonableDistribution =
      nonZeroCount > Math.min(1000, int16Array.length) * 0.1

    return isWithinRange && hasReasonableDistribution
  }

  /**
   * 現在再生中の音声を停止
   */
  public stopCurrentPlayback() {
    this.streamPlaybackGeneration++
    if (this.currentStreamReader) {
      void this.currentStreamReader.cancel().catch(() => {})
      this.currentStreamReader = null
    }
    for (const source of this.currentStreamSources) {
      try {
        source.stop()
      } catch (e) {
        logger.warn('LipSync stop stream source error:', e)
      }
    }
    this.currentStreamSources.clear()
    try {
      this.currentSource?.stop()
    } catch (e) {
      logger.warn('LipSync stopCurrentPlayback error:', e)
    }
    this.currentSource = null
  }
}
