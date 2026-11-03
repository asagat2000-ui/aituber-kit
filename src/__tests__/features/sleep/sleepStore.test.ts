import {
  isSleepingNow,
  resetSleepStateForTest,
  updateSleepWindow,
  wakeUpFromSleep,
} from '@/features/sleep/sleepStore'

describe('スリープ状態ストア', () => {
  beforeEach(() => {
    resetSleepStateForTest()
  })

  it('初期状態はスリープしていない', () => {
    expect(isSleepingNow()).toBe(false)
  })

  it('時間帯に入るとスリープする', () => {
    updateSleepWindow('2026-11-04')
    expect(isSleepingNow()).toBe(true)
  })

  it('タップで起床すると、同じ時間帯の間は起きたまま', () => {
    updateSleepWindow('2026-11-04')
    wakeUpFromSleep()
    expect(isSleepingNow()).toBe(false)
    // 同じキーで再評価されても起きたまま
    updateSleepWindow('2026-11-04')
    expect(isSleepingNow()).toBe(false)
  })

  it('次の時間帯になると再びスリープする', () => {
    updateSleepWindow('2026-11-04')
    wakeUpFromSleep()
    updateSleepWindow('2026-11-05')
    expect(isSleepingNow()).toBe(true)
  })

  it('時間帯を抜けると起床状態もリセットされる', () => {
    updateSleepWindow('2026-11-04')
    wakeUpFromSleep()
    updateSleepWindow(null)
    updateSleepWindow('2026-11-04')
    expect(isSleepingNow()).toBe(true)
  })
})
