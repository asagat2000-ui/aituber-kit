import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
 * 音声認識の唯一の持ち主。
 *
 * 以前は入力欄と画面タップが別々に useVoiceRecognition を呼んでいたため、
 * マイクの所有権が二重になり「開始と終了」を奪い合っていた。
 * ここで1つだけ生成し、必要な画面は context から受け取る。
 */

type VoiceApi = ReturnType<typeof useVoiceRecognition>

const VoiceContext = createContext<VoiceApi | null>(null)

export const useVoiceBridge = (): VoiceApi => {
  const ctx = useContext(VoiceContext)
  if (!ctx) {
    throw new Error('useVoiceBridge must be used inside <VoiceBridge>')
  }
  return ctx
}

/** 案内を出してよいかの判定（ちらつき防止） */
export const HINT_DELAY_MS = 1200

export const VoiceBridge = ({ children }: { children?: ReactNode }) => {
  const handleSendChat = handleSendChatFn()
  const api = useVoiceRecognition({ onChatProcessStart: handleSendChat })
  const value = useMemo(() => api, [api])

  const isSpeaking = homeStore((s) => s.isSpeaking)
  const showInputForm = settingsStore((s) => s.showInputForm)
  const [showHint, setShowHint] = useState(false)

  const latest = useRef({ ...api, isSpeaking })
  useEffect(() => {
    latest.current = { ...api, isSpeaking }
  }, [api, isSpeaking])

  // 入力欄を隠しているときだけ、画面タップで開始できるようにする
  useEffect(() => {
    if (showInputForm) return
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
      void s.startListening()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true)
  }, [showInputForm])

  // 案内は「しばらく何も起きていない」ときだけ出す。
  // 認識の開始・終了で即座に切り替えると、ちらついて落ち着かない。
  useEffect(() => {
    if (showInputForm) {
      setShowHint(false)
      return
    }
    const idle = !api.isListening && !isSpeaking && !api.isProcessing
    if (!idle) {
      setShowHint(false)
      return
    }
    const timer = window.setTimeout(() => setShowHint(true), HINT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [showInputForm, api.isListening, api.isProcessing, isSpeaking])

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {showHint && (
        <div
          data-testid="tap-to-start-hint"
          className="pointer-events-none fixed bottom-4 left-1/2 z-[2147483646] -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-md"
        >
          {KOHARU_TAP_HINT}
        </div>
      )}
    </VoiceContext.Provider>
  )
}

export default VoiceBridge
