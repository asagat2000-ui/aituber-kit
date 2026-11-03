/**
 * 発話後マイク自動再開（p24）の共有状態
 *
 * 「音声認識タイムアウト」で常時マイク入力がOFFになった後でも、
 * AIが話し終えたタイミングで設定秒数だけ聞き取りを再開するための状態置き場。
 * 複数のフック（useVoiceRecognition / useBrowserSpeechRecognition）から
 * 参照するため、ストアではなくモジュール変数で保持する。
 */

/** 自動再開セッションが進行中かどうか */
let autoResumeSessionActive = false

/** 最後にユーザーが手動でマイクをOFFにした時刻（epoch ms） */
let lastManualMicOffAt = 0

/** 手動OFFからこの時間は自動再開しない */
export const MANUAL_MIC_OFF_SUPPRESS_MS = 60 * 1000

/** 自動再開で開始した聞き取りセッションを記録する */
export function markAutoResumeSession(): void {
  autoResumeSessionActive = true
}

/** 自動再開セッションの記録を消す */
export function clearAutoResumeSession(): void {
  autoResumeSessionActive = false
}

/** 現在の聞き取りが自動再開によるものか */
export function isAutoResumeSession(): boolean {
  return autoResumeSessionActive
}

/** ユーザーが手動でマイクをOFFにしたことを記録する */
export function markManualMicOff(now: number = Date.now()): void {
  lastManualMicOffAt = now
  autoResumeSessionActive = false
}

/** 手動でマイクをONにしたとき、抑制を解除する */
export function clearManualMicOffSuppression(): void {
  lastManualMicOffAt = 0
}

/** 手動OFF直後の抑制期間中かどうか */
export function isManualMicOffSuppressed(now: number = Date.now()): boolean {
  if (lastManualMicOffAt === 0) return false
  return now - lastManualMicOffAt < MANUAL_MIC_OFF_SUPPRESS_MS
}

/** テスト用: 状態を初期化する */
export function resetAutoResumeStateForTest(): void {
  autoResumeSessionActive = false
  lastManualMicOffAt = 0
}
