/**
 * 1秒ごとの見張り（ウォッチドッグ）が再起動すべきかを判断する。
 *
 * ここを誤ると「止まっている」と「これから動く」を取り違え、
 * 毎秒マイクを開き直して描画が固まる。
 * 判断を1か所に集めて、テストで固定する。
 */
export type WatchdogInput = {
  /** アプリ側が「聞き取り中」と思っているか */
  isListening: boolean
  /** AIが発話中か */
  isSpeaking: boolean
  /** 返答を生成中か */
  isProcessing: boolean
  /** 認識器が実際に動いているか（onstart済み・onend未発火） */
  isRecognitionActive: boolean
  /** onend からの再起動を予約済みか */
  isRestartPending: boolean
  /** スリープ時間帯か */
  isSleeping: boolean
}

/**
 * true を返したときだけ再起動する。
 *
 * 再起動の予約中は必ず false。
 * 予約は「1秒後に動き出す」約束なので、その間は止まって見えるのが正しい。
 */
export function shouldWatchdogRestart(input: WatchdogInput): boolean {
  if (input.isSleeping) return false
  if (input.isSpeaking) return false
  if (input.isProcessing) return false
  if (input.isRestartPending) return false
  if (input.isListening && input.isRecognitionActive) return false
  return true
}

/** マイクが閉じている状態から開き直すべきか */
export function shouldWatchdogStart(input: WatchdogInput): boolean {
  if (input.isSleeping) return false
  if (input.isSpeaking) return false
  if (input.isProcessing) return false
  if (input.isRestartPending) return false
  return !input.isListening
}
