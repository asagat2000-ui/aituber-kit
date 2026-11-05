/**
 * 無音が続いたときに、マイクを止めてよいかを決める。
 *
 * 「常時マイク入力モード」は名前のとおり、マイクを開いたままにする設定。
 * ところが従来は5秒の無音でマイクを閉じ、しかも設定自体をOFFにしていた。
 * そのため一度話しかけそこなうと、以後ずっと認識しなくなっていた。
 */
export type NoSpeechInput = {
  /** 常時マイク入力モード（開いたままにする設定） */
  continuousMicListeningMode: boolean
  /** 呼びかけ待ち（無音が正常な状態） */
  wakeStandby: boolean
  /** 無音とみなすまでの秒数。0以下なら監視しない */
  initialSpeechTimeout: number
}

/**
 * 無音タイマーを張るか。
 * 常時マイクがONなら張らない（張ると数秒ごとに閉じてしまう）。
 */
export function shouldArmNoSpeechTimer(input: NoSpeechInput): boolean {
  if (!(input.initialSpeechTimeout > 0)) return false
  if (input.wakeStandby) return false
  if (input.continuousMicListeningMode) return false
  return true
}

/**
 * 無音を検出したときに、マイクを止めてよいか。
 * 常時マイクがONなら止めない。
 */
export function shouldStopOnNoSpeech(input: NoSpeechInput): boolean {
  if (input.continuousMicListeningMode) return false
  if (input.wakeStandby) return false
  return true
}

/** 認識が切れたあと、次に開くまでの待ち時間（ミリ秒） */
export function nextRestartDelay(continuousMicListeningMode: boolean): number {
  // 常時マイクなら、間を空けずに戻す。
  // 1秒空けると、その間の声がまるごと落ちる
  return continuousMicListeningMode ? 200 : 1000
}
