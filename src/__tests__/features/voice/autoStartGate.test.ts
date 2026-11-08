import { shouldAutoStartMic } from '@/features/voice/autoStartGate'

const base = {
  continuousMicListeningMode: true,
  speechRecognitionMode: 'browser',
  isListening: false,
  isSpeaking: false,
  chatProcessing: false,
  sleeping: false,
}

describe('常時マイクの開始判定', () => {
  it('常時マイクON・待機中なら開始する', () => {
    expect(shouldAutoStartMic(base)).toBe(true)
  })

  it('常時マイクOFFなら開始しない', () => {
    expect(
      shouldAutoStartMic({ ...base, continuousMicListeningMode: false })
    ).toBe(false)
  })

  it('既に聞き取り中なら開始しない', () => {
    expect(shouldAutoStartMic({ ...base, isListening: true })).toBe(false)
  })

  it('発話中・処理中・スリープ中は開始しない', () => {
    expect(shouldAutoStartMic({ ...base, isSpeaking: true })).toBe(false)
    expect(shouldAutoStartMic({ ...base, chatProcessing: true })).toBe(false)
    expect(shouldAutoStartMic({ ...base, sleeping: true })).toBe(false)
  })

  it('ブラウザ音声認識以外では開始しない', () => {
    expect(
      shouldAutoStartMic({ ...base, speechRecognitionMode: 'whisper' })
    ).toBe(false)
  })
})
