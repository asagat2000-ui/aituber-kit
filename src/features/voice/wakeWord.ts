/**
 * ウェイクワード（呼びかけ）による会話の開始／終了を管理する
 *
 * 待機中はマイクを開いたまま「認識結果を送らない」状態にし、
 * 決め言葉を検出したときだけ会話モードへ入る。
 * 会話モードでは従来どおり常時マイクでラリーを続け、
 * 一定時間の無音で待機へ戻る。
 */

import settingsStore from '@/features/stores/settings'

let standby = true
let standbyInitialized = false

/** 全角英数・記号を寄せて、比較しやすい形に正規化する */
export function normalizeSpeech(text: string): string {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      // カタカナはひらがなに寄せる（「ネエ」→「ねえ」）
      .replace(/[\u30a1-\u30f6]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      )
      .replace(/[\s\u3000]/g, '')
      .replace(/[、。,.!?！？「」『』・…ー~〜\-]/g, '')
  )
}

/**
 * 母音だけを落とした比較用の形。
 * 音声認識は「ねえ」を「ねー」「ねぇ」と返すことがあるため、
 * 母音を無視した形でも一致を見る。
 */
function stripVowels(text: string): string {
  return text.replace(/[あいうえおぁぃぅぇぉ]/g, '')
}

/**
 * 決め言葉を配列にする。
 * 区切りはカンマ（,）と改行のみ。読点（、）は語句の一部として扱う
 * （「ねえ、こはる」を分割すると「ねえ」「こはる」単体になって誤反応するため）。
 */
export function parseWakePhrases(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((phrase) => normalizeSpeech(phrase))
    .filter((phrase) => phrase.length > 0)
}

/** 認識テキストに決め言葉が含まれるか */
export function containsWakePhrase(text: string, rawPhrases: string): boolean {
  const normalized = normalizeSpeech(text)
  if (!normalized) return false

  const looseText = stripVowels(normalized)

  return parseWakePhrases(rawPhrases).some((phrase) => {
    if (normalized.includes(phrase)) return true
    // 母音を落とした比較は、短い語だと誤反応するので長めの語だけに使う
    const loosePhrase = stripVowels(phrase)
    return loosePhrase.length >= 3 && looseText.includes(loosePhrase)
  })
}

/** ウェイクワード機能が有効か */
export function isWakeModeOn(): boolean {
  return Boolean(settingsStore.getState().wakeWordEnabled)
}

/** 待機中（呼びかけ待ち）かどうか。機能がOFFなら常に false */
export function isWakeStandby(): boolean {
  if (!isWakeModeOn()) return false
  if (!standbyInitialized) {
    standby = true
    standbyInitialized = true
  }
  return standby
}

/** 待機状態を切り替える */
export function setWakeStandby(value: boolean): void {
  standby = value
  standbyInitialized = true
}

/** 会話モードに入る（呼びかけを検出したとき） */
export function enterConversation(): void {
  setWakeStandby(false)
}

/** テスト用: 状態を初期化する */
export function resetWakeStateForTest(): void {
  standby = true
  standbyInitialized = false
}
