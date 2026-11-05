import { useEffect, useRef } from 'react'
import settingsStore from '@/features/stores/settings'
import homeStore from '@/features/stores/home'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
import { handleSendChatFn } from '@/features/chat/handlers'
import { KOHARU_TAP_HINT } from '@/features/prompts/koharu'
import {
  markTapHandled,
  primeIosAudio,
  shouldStartOnTap,
} from '@/features/voice/tapToStart'

/**
 * 入力欄を隠しているときだけ有効になる。
 * 画面のどこかを触れば、音声を解錠してマイクを開始する。
 */
const TapToStartInner = () => {
  const handleSendChat = handleSendChatFn()
  const { isListening, isProcessing, startListening } = useVoiceRecognition({
    onChatProcessStart: handleSendChat,
  })
  const isSpeaking = homeStore((s) => s.isSpeaking)

  const latest = useRef({
    isListening,
    isProcessing,
    isSpeaking,
    startListening,
  })

  useEffect(() => {
    latest.current = { isListening, isProcessing, isSpeaking, startListening }
  }, [isListening, isProcessing, isSpeaking, startListening])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const s = latest.current
      const allowed = shouldStartOnTap({
        target: event.target,
        isListening: s.isListening,
        isSpeaking: s.isSpeaking,
        isProcessing: s.isProcessing,
      })
      if (!allowed) return
      markTapHandled()
      primeIosAudio()
      s.startListening()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  // 音声が始まるまでは、触る場所を1行だけ案内する
  const showHint = !isListening && !isSpeaking && !isProcessing

  return (
    <>
      {showHint && (
        <div
          data-testid="tap-to-start-hint"
          className="pointer-events-none fixed bottom-4 left-1/2 z-[2147483646] -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-md"
        >
          {KOHARU_TAP_HINT}
        </div>
      )}
    </>
  )
}

export const TapToStart = () => {
  const showInputForm = settingsStore((s) => s.showInputForm)
  // 入力欄が出ているときは、そちらのマイクボタンに任せる（二重起動を防ぐ）
  if (showInputForm) return null
  return <TapToStartInner />
}
