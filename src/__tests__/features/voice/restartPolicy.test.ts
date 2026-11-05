import {
  WatchdogInput,
  shouldWatchdogRestart,
  shouldWatchdogStart,
} from '@/features/voice/restartPolicy'

const base: WatchdogInput = {
  isListening: true,
  isSpeaking: false,
  isProcessing: false,
  isRecognitionActive: false,
  isRestartPending: false,
  isSleeping: false,
}

describe('1秒ごとの見張りの判断', () => {
  it('再起動の予約中は叩き直さない（p34で毎秒再起動していた原因）', () => {
    expect(shouldWatchdogRestart({ ...base, isRestartPending: true })).toBe(
      false
    )
    expect(
      shouldWatchdogStart({
        ...base,
        isListening: false,
        isRestartPending: true,
      })
    ).toBe(false)
  })

  it('予約が無く、実際に止まっていれば再起動する', () => {
    expect(shouldWatchdogRestart(base)).toBe(true)
  })

  it('実際に動いていれば何もしない', () => {
    expect(shouldWatchdogRestart({ ...base, isRecognitionActive: true })).toBe(
      false
    )
  })

  it('発話中・生成中は触らない', () => {
    expect(shouldWatchdogRestart({ ...base, isSpeaking: true })).toBe(false)
    expect(shouldWatchdogRestart({ ...base, isProcessing: true })).toBe(false)
  })

  it('スリープ時間帯は開かない', () => {
    expect(shouldWatchdogRestart({ ...base, isSleeping: true })).toBe(false)
    expect(
      shouldWatchdogStart({ ...base, isListening: false, isSleeping: true })
    ).toBe(false)
  })

  it('マイクが閉じていれば開き直す', () => {
    expect(shouldWatchdogStart({ ...base, isListening: false })).toBe(true)
  })

  it('聞き取り中なら開き直さない', () => {
    expect(shouldWatchdogStart(base)).toBe(false)
  })
})
