import fs from 'fs'
import path from 'path'
import settingsStore from '@/features/stores/settings'
import {
  containsWakePhrase,
  isWakeStandby,
  passWakeGate,
  resetWakeGateForTest,
} from '@/features/voice/wakeGate'

const enable = (phrases = 'ねえ、こはる') =>
  settingsStore.setState({
    wakeWordEnabled: true,
    wakeWordPhrases: phrases,
    wakeWordConversationTimeout: 30,
  })

describe('呼びかけの関所', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    resetWakeGateForTest()
    enable()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('決め言葉の表記ゆれを拾う', () => {
    expect(containsWakePhrase('ねえ、こはる', 'ねえ、こはる')).toBe(true)
    expect(containsWakePhrase('ねぇこはる', 'ねえ、こはる')).toBe(true)
    expect(containsWakePhrase('ネエ、コハル', 'ねえ、こはる')).toBe(true)
  })

  it('決め言葉でない言葉は拾わない', () => {
    expect(containsWakePhrase('今日は寒いね', 'ねえ、こはる')).toBe(false)
  })

  it('機能OFFなら何でも通す（従来の挙動）', () => {
    settingsStore.setState({ wakeWordEnabled: false })
    expect(passWakeGate('今日は寒いね')).toBe(true)
  })

  it('待機中は呼びかけだけ通し、会話に入る', () => {
    expect(isWakeStandby()).toBe(true)
    expect(passWakeGate('ねえ、こはる')).toBe(true)
    expect(isWakeStandby()).toBe(false)
  })

  it('待機中は呼びかけ以外を通さない', () => {
    expect(passWakeGate('今日は寒いね')).toBe(false)
    expect(isWakeStandby()).toBe(true)
  })

  it('会話中は何でも通す', () => {
    passWakeGate('ねえ、こはる')
    expect(passWakeGate('今日は寒いね')).toBe(true)
  })

  it('会話中に無音が続くと待機に戻る', () => {
    passWakeGate('ねえ、こはる')
    expect(isWakeStandby()).toBe(false)
    jest.advanceTimersByTime(31_000)
    expect(isWakeStandby()).toBe(true)
  })

  it('会話が続いている間は待機に戻らない', () => {
    passWakeGate('ねえ、こはる')
    jest.advanceTimersByTime(20_000)
    passWakeGate('そうだね')
    jest.advanceTimersByTime(20_000)
    expect(isWakeStandby()).toBe(false)
  })

  it('マイクを動かすコードを一切持たない（前回の再発防止）', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/features/voice/wakeGate.ts'),
      'utf-8'
    )
    for (const forbidden of [
      'startListening',
      'stopListening',
      'useBrowserSpeechRecognition',
      'useVoiceRecognition',
      'recognition',
      'getUserMedia',
    ]) {
      expect(src).not.toContain(forbidden)
    }
  })
})
