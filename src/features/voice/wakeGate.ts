/**
 * 呼びかけ（ウェイクワード）の関所。
 *
 * ここは「送ってよいか」を判断するだけで、マイクには一切触れない。
 * マイクの開始・停止・再起動は p26 から動いている音声コードが握ったまま。
 *
 * こうすることで、この判断に不具合があっても
 * 最悪「返事をしない」で済み、マイクが死ぬことはない。
 */
import settingsStore from '@/features/stores/settings'

let standby = true
let conversationTimer: ReturnType<typeof setTimeout> | null = null

/** 全角英数・記号を寄せて比較しやすくする */
export function normalizeSpeech(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    )
    .replace(/[\s\u3000]/g, '')
    .replace(/[、。,.!?！？「」『』・…ー~〜\-]/g, '')
}

/** 母音を落とした比較用（「ねえ」→「ねー」等の揺れ対策） */
function stripVowels(text: string): string {
  return text.replace(/[あいうえおぁぃぅぇぉ]/g, '')
}

/**
 * 決め言葉を配列にする。
 * 区切りはカンマと改行のみ。読点は語句の一部として扱う
 * （「ねえ、こはる」を分割すると誤反応するため）。
 */
export function parseWakePhrases(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((p) => normalizeSpeech(p))
    .filter((p) => p.length > 0)
}

export function containsWakePhrase(text: string, rawPhrases: string): boolean {
  const normalized = normalizeSpeech(text)
  if (!normalized) return false
  const looseText = stripVowels(normalized)
  return parseWakePhrases(rawPhrases).some((phrase) => {
    if (normalized.includes(phrase)) return true
    const loosePhrase = stripVowels(phrase)
    return loosePhrase.length >= 3 && looseText.includes(loosePhrase)
  })
}

export function isWakeGateOn(): boolean {
  return Boolean(settingsStore.getState().wakeWordEnabled)
}

export function isWakeStandby(): boolean {
  if (!isWakeGateOn()) return false
  return standby
}

export function clearConversationTimer(): void {
  if (conversationTimer) {
    clearTimeout(conversationTimer)
    conversationTimer = null
  }
}

/** 会話モードの無音タイマーを張り直す */
function armConversationTimer(): void {
  clearConversationTimer()
  const seconds = settingsStore.getState().wakeWordConversationTimeout
  if (!(seconds > 0)) return
  conversationTimer = setTimeout(() => {
    standby = true
    conversationTimer = null
  }, seconds * 1000)
}

export function enterConversation(): void {
  standby = false
  armConversationTimer()
}

export function returnToStandby(): void {
  standby = true
  clearConversationTimer()
}

/**
 * 音声で認識した文字を、送信してよいか判断する。
 * true を返したものだけが実際に送られる。
 */
export function passWakeGate(text: string): boolean {
  if (!isWakeGateOn()) return true

  if (standby) {
    if (containsWakePhrase(text, settingsStore.getState().wakeWordPhrases)) {
      enterConversation()
      return true
    }
    // 呼びかけではないので送らない。ただしマイクは止めない
    return false
  }

  armConversationTimer()
  return true
}

/** テスト用 */
export function resetWakeGateForTest(): void {
  standby = true
  clearConversationTimer()
}
