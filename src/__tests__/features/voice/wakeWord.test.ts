import {
  containsWakePhrase,
  enterConversation,
  isWakeStandby,
  normalizeSpeech,
  parseWakePhrases,
  resetWakeStateForTest,
  setWakeStandby,
} from '@/features/voice/wakeWord'

describe('ウェイクワードの判定', () => {
  beforeEach(() => {
    resetWakeStateForTest()
  })

  it('表記ゆれを吸収できる', () => {
    expect(normalizeSpeech('ねえ、こはる。')).toBe('ねえこはる')
    expect(normalizeSpeech('ネエ　コハル')).toBe('ねえこはる')
    expect(normalizeSpeech('ねー こはる')).toBe('ねこはる')
  })

  it('カンマ区切りで複数登録できる', () => {
    expect(parseWakePhrases('ねえ、こはる, こはるさん')).toEqual([
      'ねえこはる',
      'こはるさん',
    ])
    // 読点では分割しない（「ねえ」「こはる」単体になると誤反応するため）
    expect(parseWakePhrases('ねえ、こはる')).toEqual(['ねえこはる'])
  })

  it('決め言葉を含む発話を検出する', () => {
    expect(containsWakePhrase('ねえ、こはる', 'ねえ、こはる')).toBe(true)
    expect(containsWakePhrase('ねえこはる、きょうは？', 'ねえ、こはる')).toBe(
      true
    )
    // 認識が「ねー」と返しても拾う
    expect(containsWakePhrase('ねー、こはる', 'ねえ、こはる')).toBe(true)
  })

  it('無関係な発話は検出しない', () => {
    expect(containsWakePhrase('きょうは いい天気だね', 'ねえ、こはる')).toBe(
      false
    )
    expect(containsWakePhrase('', 'ねえ、こはる')).toBe(false)
  })

  it('会話モードに入ると待機ではなくなる', () => {
    setWakeStandby(true)
    enterConversation()
    // 設定がOFFのテスト環境では待機扱いにならない
    expect(isWakeStandby()).toBe(false)
  })
})
