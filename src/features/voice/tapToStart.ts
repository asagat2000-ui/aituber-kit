/**
 * 画面タップで音声を開始する
 *
 * 入力欄を隠すとマイクボタンも消えるため、両親が「触る場所」を失う。
 * 画面のどこかを1点触れば、音声の解錠とマイク開始を同時に行う。
 * ボタンやリンクの上は邪魔しない（設定画面の操作を壊さない）。
 */

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, [role="button"], [contenteditable="true"]'

/** 連続タップで二重に開始しないための間隔 */
export const TAP_TO_START_COOLDOWN_MS = 1200

let lastHandledAt = 0

/** タップ先が操作部品かどうか */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return Boolean(el.closest(INTERACTIVE_SELECTOR))
}

/** このタップでマイクを開始してよいか */
export function shouldStartOnTap(params: {
  target: EventTarget | null
  isListening: boolean
  isSpeaking: boolean
  isProcessing: boolean
  now?: number
}): boolean {
  const {
    target,
    isListening,
    isSpeaking,
    isProcessing,
    now = Date.now(),
  } = params

  if (isListening || isSpeaking || isProcessing) return false
  if (isInteractiveTarget(target)) return false
  if (now - lastHandledAt < TAP_TO_START_COOLDOWN_MS) return false
  return true
}

export function markTapHandled(now = Date.now()): void {
  lastHandledAt = now
}

export function resetTapToStartForTest(): void {
  lastHandledAt = 0
}

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA='

/**
 * iOS はユーザー操作の中でしか音声を解錠できない。
 * 無音を1回鳴らして、この後の再生を許可させる。
 */
export function primeIosAudio(): void {
  if (typeof window === 'undefined' || typeof window.Audio !== 'function') {
    return
  }
  try {
    const el = new window.Audio(SILENT_WAV)
    el.setAttribute('playsinline', 'true')
    el.volume = 0.01
    const played = el.play()
    if (played && typeof played.catch === 'function') {
      played.catch(() => {
        /* 次のタップで再試行される */
      })
    }
  } catch {
    /* noop */
  }
}
