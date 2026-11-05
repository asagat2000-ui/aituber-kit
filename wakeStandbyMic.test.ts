import {
  isWakeStandby,
  resetWakeStateForTest,
  setWakeStandby,
} from '@/features/voice/wakeWord'
import settingsStore from '@/features/stores/settings'

describe('呼びかけ待ちのマイク維持', () => {
  beforeEach(() => {
    resetWakeStateForTest()
  })

  it('機能OFFなら待機扱いにならない（従来の挙動を壊さない）', () => {
    settingsStore.setState({ wakeWordEnabled: false })
    expect(isWakeStandby()).toBe(false)
  })

  it('機能ONの初期状態は待機になる', () => {
    settingsStore.setState({ wakeWordEnabled: true })
    resetWakeStateForTest()
    expect(isWakeStandby()).toBe(true)
  })

  it('会話に入ると待機ではなくなる', () => {
    settingsStore.setState({ wakeWordEnabled: true })
    setWakeStandby(false)
    expect(isWakeStandby()).toBe(false)
  })
})
