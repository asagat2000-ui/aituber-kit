import { renderHook } from '@testing-library/react'
import settingsStore from '@/features/stores/settings'
import { resetWakeGateForTest } from '@/features/voice/wakeGate'
import { useWakeGate } from '@/features/voice/useWakeGate'

describe('useWakeGate', () => {
  beforeEach(() => {
    resetWakeGateForTest()
    settingsStore.setState({ wakeWordEnabled: false })
  })

  it('再レンダーしても関数の同一性が変わらない（マイク攪拌の再発防止）', () => {
    const first = jest.fn()
    const second = jest.fn()
    const { result, rerender } = renderHook(({ send }) => useWakeGate(send), {
      initialProps: { send: first },
    })

    const before = result.current
    rerender({ send: second })
    rerender({ send: first })
    rerender({ send: second })

    expect(result.current).toBe(before)
  })

  it('常に最新の送信関数を呼ぶ', () => {
    const first = jest.fn()
    const second = jest.fn()
    const { result, rerender } = renderHook(({ send }) => useWakeGate(send), {
      initialProps: { send: first },
    })

    rerender({ send: second })
    result.current('こんにちは')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('こんにちは')
  })

  it('関所を通らない言葉は送らない', () => {
    settingsStore.setState({
      wakeWordEnabled: true,
      wakeWordPhrases: 'ねえ、こはる',
      wakeWordConversationTimeout: 30,
    })
    resetWakeGateForTest()

    const send = jest.fn()
    const { result } = renderHook(() => useWakeGate(send))

    result.current('今日は寒いね')
    expect(send).not.toHaveBeenCalled()

    result.current('ねえ、こはる')
    expect(send).toHaveBeenCalledWith('ねえ、こはる')
  })
})
