import {
  MANUAL_MIC_OFF_SUPPRESS_MS,
  clearAutoResumeSession,
  clearManualMicOffSuppression,
  isAutoResumeSession,
  isManualMicOffSuppressed,
  markAutoResumeSession,
  markManualMicOff,
  resetAutoResumeStateForTest,
} from '@/features/voice/autoResumeState'

describe('発話後マイク自動再開の共有状態', () => {
  beforeEach(() => {
    resetAutoResumeStateForTest()
  })

  it('初期状態では抑制されていない', () => {
    expect(isManualMicOffSuppressed()).toBe(false)
    expect(isAutoResumeSession()).toBe(false)
  })

  it('手動OFFの直後は抑制される', () => {
    const now = 1_000_000
    markManualMicOff(now)
    expect(isManualMicOffSuppressed(now)).toBe(true)
  })

  it('手動OFFから60秒経過すると抑制が解ける', () => {
    const now = 1_000_000
    markManualMicOff(now)
    expect(isManualMicOffSuppressed(now + MANUAL_MIC_OFF_SUPPRESS_MS - 1)).toBe(
      true
    )
    expect(isManualMicOffSuppressed(now + MANUAL_MIC_OFF_SUPPRESS_MS)).toBe(
      false
    )
  })

  it('手動ONで抑制を解除できる', () => {
    const now = 1_000_000
    markManualMicOff(now)
    clearManualMicOffSuppression()
    expect(isManualMicOffSuppressed(now)).toBe(false)
  })

  it('自動再開セッションの記録と解除', () => {
    markAutoResumeSession()
    expect(isAutoResumeSession()).toBe(true)
    clearAutoResumeSession()
    expect(isAutoResumeSession()).toBe(false)
  })

  it('手動OFFすると自動再開セッションも終了する', () => {
    markAutoResumeSession()
    markManualMicOff(1_000_000)
    expect(isAutoResumeSession()).toBe(false)
  })
})
