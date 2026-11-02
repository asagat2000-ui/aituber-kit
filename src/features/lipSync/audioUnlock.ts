import { logger } from '@/lib/logger'

/**
 * iOS Safari の音声まわりの面倒を一箇所にまとめる。
 *
 * iOS の制約:
 *  - ユーザー操作の外で作った AudioContext は suspended のまま
 *  - いったん「起動できない」状態になった Context は resume() が永久に効かない
 *  - AudioContext を作りすぎると以降の Context が動かなくなる
 *  - close() した Context は二度と復帰できない
 *  - サイレントスイッチが下だと Web Audio は無音（<audio> は鳴る）
 *
 * 対策:
 *  - Context は共有して作りすぎない
 *  - 復帰できないと分かったら、**ユーザー操作の中で**作り直す
 *    （操作中に new AudioContext() すると running で始まる）
 *  - 最初のタップで無音WAVを鳴らして音声セッションを「再生」に切り替える
 */

const SILENT_WAV_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAAABAAQAAQAEAAABAAQAATAAgAAAAAABkYXRhAAAAAA=='

export type AudioContextHolder = {
  /** 現在の Context を返す */
  get: () => AudioContext | null
  /** Context が差し替えられたときに呼ばれる */
  onReplace?: (ctx: AudioContext) => void
}

const holders = new Set<AudioContextHolder>()
let shared: AudioContext | null = null
let unlocked = false
let attached = false
let gestureCount = 0
let replaceCount = 0

/** 共有 AudioContext。forceNew または close 済みなら作り直す */
export function getSharedAudioContext(forceNew = false): AudioContext {
  if (forceNew || !shared || shared.state === 'closed') {
    shared = new AudioContext()
    if (forceNew) replaceCount++
    holders.forEach((h) => h.onReplace?.(shared as AudioContext))
  }
  return shared
}

export function registerAudioContext(holder: AudioContextHolder): void {
  holders.add(holder)
  attachGestureListeners()
}

/** 無音を <audio> で鳴らし、音声セッションを「再生」に切り替える */
function unlockSession(): void {
  if (unlocked) return
  unlocked = true
  try {
    if (typeof window === 'undefined' || typeof window.Audio !== 'function') {
      unlocked = false
      return
    }
    const el = new Audio()
    el.setAttribute('playsinline', 'true')
    el.setAttribute('webkit-playsinline', 'true')
    el.src = SILENT_WAV_URI
    el.volume = 0.01
    const played = el.play()
    if (played && typeof played.catch === 'function') {
      played.catch(() => {
        unlocked = false
      })
    }
  } catch (error) {
    unlocked = false
    logger.warn('Failed to unlock audio session:', error)
  }
}

/**
 * タップを契機に、鳴らせる状態へ持っていく。
 * 「操作の中で作る」のが唯一確実な方法なので、復帰できなければ作り直す。
 */
function recoverInGesture(): void {
  const ctx = shared
  if (!ctx || ctx.state === 'closed') {
    getSharedAudioContext(true)
    return
  }
  if (ctx.state === 'running') return

  // 操作中に resume しておく（効けば作り直さずに済む）
  ctx.resume().catch(() => {})

  // resume が効かない iOS のために、少し待ってから状態を見て作り直す。
  // 作り直しは「操作の直後」でも通ることが多い。
  // テスト環境ではタイマーが残って固まるため、実ブラウザのみ実行する
  if (typeof window === 'undefined' || typeof window.Audio !== 'function') {
    return
  }

  window.setTimeout(() => {
    if (shared === ctx && ctx.state !== 'running') {
      logger.log('AudioContext did not resume; recreating inside gesture')
      getSharedAudioContext(true)
      const next = shared
      next?.resume().catch(() => {})
    }
  }, 120)
}

/** タップ・クリックのたびに復帰を試す（一度きりにしない） */
export function attachGestureListeners(): void {
  if (attached || typeof window === 'undefined') return
  attached = true

  const events = ['pointerdown', 'touchstart', 'click', 'keydown']
  const handler = () => {
    gestureCount++
    // テスト環境など AudioContext が無い場所では何もしない
    if (typeof AudioContext === 'undefined') return
    unlockSession()
    recoverInGesture()
  }
  events.forEach((e) => window.addEventListener(e, handler, true))
}

/** 診断用: タップを何回検出したか */
export function getGestureCount(): number {
  return gestureCount
}

/** 診断用: Context を作り直した回数 */
export function getReplaceCount(): number {
  return replaceCount
}
