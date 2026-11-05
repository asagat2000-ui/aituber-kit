import {
  nextRestartDelay,
  shouldArmNoSpeechTimer,
  shouldStopOnNoSpeech,
} from '@/features/voice/noSpeechPolicy'

const base = {
  continuousMicListeningMode: false,
  wakeStandby: false,
  initialSpeechTimeout: 5,
}

describe('無音のときマイクを閉じてよいか', () => {
  it('常時マイクONなら、無音タイマーを張らない（数秒ごとに閉じない）', () => {
    expect(
      shouldArmNoSpeechTimer({ ...base, continuousMicListeningMode: true })
    ).toBe(false)
  })

  it('常時マイクONなら、無音でも止めない', () => {
    expect(
      shouldStopOnNoSpeech({ ...base, continuousMicListeningMode: true })
    ).toBe(false)
  })

  it('常時マイクOFFなら、従来どおり5秒で止める', () => {
    expect(shouldArmNoSpeechTimer(base)).toBe(true)
    expect(shouldStopOnNoSpeech(base)).toBe(true)
  })

  it('呼びかけ待ちは無音が正常なので張らない', () => {
    expect(shouldArmNoSpeechTimer({ ...base, wakeStandby: true })).toBe(false)
  })

  it('0秒設定なら監視しない', () => {
    expect(shouldArmNoSpeechTimer({ ...base, initialSpeechTimeout: 0 })).toBe(
      false
    )
  })

  it('常時マイクなら再開の間隔を詰める', () => {
    expect(nextRestartDelay(true)).toBe(200)
    expect(nextRestartDelay(false)).toBe(1000)
  })
})
