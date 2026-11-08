/**
 * 常時マイク入力を「今この瞬間に開始してよいか」だけを判定する純粋関数。
 *
 * マイクを動かすコードはここに置かない（判定と実行を分ける）。
 */
export type AutoStartInput = {
  continuousMicListeningMode: boolean
  speechRecognitionMode: string
  isListening: boolean
  isSpeaking: boolean
  chatProcessing: boolean
  sleeping: boolean
}

export const shouldAutoStartMic = (s: AutoStartInput): boolean =>
  s.continuousMicListeningMode &&
  s.speechRecognitionMode === 'browser' &&
  !s.isListening &&
  !s.isSpeaking &&
  !s.chatProcessing &&
  !s.sleeping
