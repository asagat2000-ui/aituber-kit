import {
  isInteractiveTarget,
  markTapHandled,
  resetTapToStartForTest,
  shouldStartOnTap,
  TAP_TO_START_COOLDOWN_MS,
} from '@/features/voice/tapToStart'

describe('画面タップで音声を開始する判定', () => {
  beforeEach(() => {
    resetTapToStartForTest()
  })

  it('何も起きていないときのタップは開始する', () => {
    expect(
      shouldStartOnTap({
        target: document.body,
        isListening: false,
        isSpeaking: false,
        isProcessing: false,
      })
    ).toBe(true)
  })

  it('すでに聞いている・話している・考えているときは開始しない', () => {
    expect(
      shouldStartOnTap({
        target: document.body,
        isListening: true,
        isSpeaking: false,
        isProcessing: false,
      })
    ).toBe(false)
    expect(
      shouldStartOnTap({
        target: document.body,
        isListening: false,
        isSpeaking: true,
        isProcessing: false,
      })
    ).toBe(false)
    expect(
      shouldStartOnTap({
        target: document.body,
        isListening: false,
        isSpeaking: false,
        isProcessing: true,
      })
    ).toBe(false)
  })

  it('ボタンやリンクの上のタップは邪魔しない', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    expect(isInteractiveTarget(button)).toBe(true)
    expect(
      shouldStartOnTap({
        target: button,
        isListening: false,
        isSpeaking: false,
        isProcessing: false,
      })
    ).toBe(false)
    button.remove()
  })

  it('直後の連続タップでは二重に開始しない', () => {
    markTapHandled(1000)
    expect(
      shouldStartOnTap({
        target: document.body,
        isListening: false,
        isSpeaking: false,
        isProcessing: false,
        now: 1000 + TAP_TO_START_COOLDOWN_MS - 1,
      })
    ).toBe(false)
    expect(
      shouldStartOnTap({
        target: document.body,
        isListening: false,
        isSpeaking: false,
        isProcessing: false,
        now: 1000 + TAP_TO_START_COOLDOWN_MS,
      })
    ).toBe(true)
  })
})
