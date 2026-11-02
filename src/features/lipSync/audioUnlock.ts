import { logger } from '@/lib/logger'

/**
 * iOS Safari の音声まわりの面倒を一箇所にまとめる。
 *
 * iOS の制約:
 *  - ユーザー操作の外で作った AudioContext は suspended のまま
 *  - resume() が「解決も拒否もされない」ことがある
 *  - AudioContext を作りすぎると以降の Context が動かなくなる
 *  - close() した Context は二度と復帰できない
 *  - サイレントスイッチが下だと Web Audio は無音（<audio> は鳴る）
 *
 * 対策:
 *  - Context は共有して作りすぎない
 *  - close 済みなら作り直す（復帰は不可能なため）
 *  - 最初のタップで無音WAVを鳴らして音声セッションを「再生」に切り替える
 */

const SILENT_WAV_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAAABAAQAAQAEAAABAAQAATAAgAAAAAABkYXRhAAAAAA=='

type Registration = {
  /** 現在の Context を返す */
  get: () => AudioContext | null
  /** close 済みのときに作り直して差し替える */
  recreate: () => void
}

const registrations = new Set<Registration>()
let shared: AudioContext | null = null
let unlocked = false
let listening = false

/** 共有 AudioContext。close 済みなら作り直す */
export function getSharedAudioContext(): AudioContext {
  if (!shared || shared.state === 'closed') {
    shared = new AudioContext()
  }
  return shared
}

export function registerAudioContext(reg: Registration): void {
  registrations.add(reg)
  attachGestureListeners()
}

/** 無音を <audio> で鳴らし、音声セッションを「再生」に切り替える */
function unlockSession(): void {
  if (unlocked) return
  unlocked = true
  try {
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

let attached = false

/** タップ・クリックのたびに、全 Context の復帰を試す（一度きりにしない） */
export function attachGestureListeners(): void {
  if (attached || typeof window === 'undefined') return
  attached = true

  const events = ['pointerdown', 'touchstart', 'click', 'keydown']
  const handler = () => {
    unlockSession()
    registrations.forEach((reg) => {
      const ctx = reg.get()
      if (!ctx || ctx.state === 'closed') {
        reg.recreate()
        return
      }
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => {})
      }
    })
  }
  events.forEach((e) => window.addEventListener(e, handler, true))
  listening = true
}

export function isListening(): boolean {
  return listening
}
