import { logger } from '@/lib/logger'
import { useEffect, useCallback, useRef } from 'react'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'
import settingsStore from '@/features/stores/settings'
import homeStore from '@/features/stores/home'
import { SpeakQueue } from '@/features/messages/speakQueue'
import {
  clearAutoResumeSession,
  clearManualMicOffSuppression,
  isManualMicOffSuppressed,
  markAutoResumeSession,
  markManualMicOff,
} from '@/features/voice/autoResumeState'
import { isSleepingNow } from '@/features/sleep/sleepStore'
import { isWakeStandby, isWakeModeOn } from '@/features/voice/wakeWord'
import {
  shouldWatchdogRestart,
  shouldWatchdogStart,
} from '@/features/voice/restartPolicy'
import { useBrowserSpeechRecognition } from './useBrowserSpeechRecognition'
import { useWhisperRecognition } from './useWhisperRecognition'
import { useRealtimeVoiceAPI } from './useRealtimeVoiceAPI'
import { useLiveTranscription } from './useLiveTranscription'
import {
  DEFAULT_VOICE_INPUT_SHORTCUT,
  hasCommandModifier,
  isEditableKeyboardTarget,
  isKeyboardShortcutRelease,
  matchesKeyboardShortcut,
} from '@/utils/keyboardShortcut'

type UseVoiceRecognitionProps = {
  onChatProcessStart: (text: string) => void
}

/**
 * 音声認識フックのメインインターフェース
 * 各モード（ブラウザ、Whisper、リアルタイムAPI）に応じて適切なフックを使用
 */
export function useVoiceRecognition({
  onChatProcessStart,
}: UseVoiceRecognitionProps) {
  // ----- 設定の取得 -----
  const speechRecognitionMode = settingsStore((s) => s.speechRecognitionMode)
  const realtimeAPIMode = settingsStore((s) => s.realtimeAPIMode)
  const continuousMicListeningMode = settingsStore(
    (s) => s.continuousMicListeningMode
  )
  const initialSpeechTimeout = settingsStore((s) => s.initialSpeechTimeout)
  const afterSpeakAutoResume = settingsStore((s) => s.afterSpeakAutoResume)
  const voiceInputShortcut =
    settingsStore((s) => s.voiceInputShortcut) || DEFAULT_VOICE_INPUT_SHORTCUT

  // ----- 各モードのフックを使用 -----
  // ブラウザ音声認識フック
  const browserSpeech = useBrowserSpeechRecognition(onChatProcessStart)

  // Whisper音声認識フック
  const whisperSpeech = useWhisperRecognition(onChatProcessStart)

  // リアルタイムAPI処理フック
  const realtimeAPI = useRealtimeVoiceAPI(onChatProcessStart)

  // OpenAIライブ文字起こしフック
  const liveTranscription = useLiveTranscription(onChatProcessStart)

  // ----- 現在のモードに基づいて適切なフックを選択 -----
  const currentHook = realtimeAPIMode
    ? realtimeAPI
    : speechRecognitionMode === 'whisper'
      ? whisperSpeech
      : speechRecognitionMode === 'live-transcription'
        ? liveTranscription
        : browserSpeech

  // ----- currentHookの関数参照をrefで保持（依存配列からcurrentHookを除去するため） -----
  const currentHookRef = useRef({
    startListening: currentHook.startListening,
    stopListening: currentHook.stopListening,
    toggleListening: currentHook.toggleListening,
    userMessage: currentHook.userMessage,
    isListening: currentHook.isListening,
    handleInputChange: currentHook.handleInputChange,
    checkRecognitionActive:
      'checkRecognitionActive' in currentHook
        ? (currentHook as any).checkRecognitionActive
        : null,
    isRestartPending:
      'isRestartPending' in currentHook
        ? (currentHook as any).isRestartPending
        : null,
    isSettling:
      'isSettling' in currentHook ? (currentHook as any).isSettling : null,
  })
  const voiceInputShortcutRef = useRef(voiceInputShortcut)
  const activeVoiceShortcutRef = useRef<string | null>(null)
  const shortcutStartPromiseRef = useRef<Promise<boolean> | null>(null)

  // ref更新はeffectで（render中アクセス禁止lint対策）
  useIsomorphicLayoutEffect(() => {
    currentHookRef.current = {
      startListening: currentHook.startListening,
      stopListening: currentHook.stopListening,
      toggleListening: currentHook.toggleListening,
      userMessage: currentHook.userMessage,
      isListening: currentHook.isListening,
      handleInputChange: currentHook.handleInputChange,
      checkRecognitionActive:
        'checkRecognitionActive' in currentHook
          ? (currentHook as any).checkRecognitionActive
          : null,
      isRestartPending:
        'isRestartPending' in currentHook
          ? (currentHook as any).isRestartPending
          : null,
      isSettling:
        'isSettling' in currentHook ? (currentHook as any).isSettling : null,
    }
  }, [currentHook])

  useIsomorphicLayoutEffect(() => {
    voiceInputShortcutRef.current = voiceInputShortcut
  }, [voiceInputShortcut])

  // ----- 音声停止 -----
  const handleStopSpeaking = useCallback(() => {
    // isSpeaking を false に設定し、発話キューを完全に停止
    homeStore.setState({ isSpeaking: false })
    SpeakQueue.stopAll()

    // 常時マイク入力モードの場合、ストップ後にマイクを再開
    // （stopAllではコールバックが呼ばれないため、ここで再開処理を行う）
    if (
      settingsStore.getState().continuousMicListeningMode &&
      settingsStore.getState().speechRecognitionMode === 'browser' &&
      !homeStore.getState().chatProcessing
    ) {
      logger.log('🔄 ストップボタンが押されました。音声認識を再開します。')
      setTimeout(() => {
        currentHookRef.current.startListening()
      }, 300)
    }
  }, [])

  // AIの発話完了後に音声認識を自動的に再開する処理
  const handleSpeakCompletion = useCallback(() => {
    if (speechRecognitionMode !== 'browser') return
    if (homeStore.getState().chatProcessing) return
    // スリープ時間帯は発話後の自動再開をしない
    if (isSleepingNow()) return

    // ウェイクワード運用中は、待機中でも呼びかけを拾うためマイクを開き直す
    if (isWakeModeOn()) {
      setTimeout(() => {
        if (
          !homeStore.getState().isSpeaking &&
          !homeStore.getState().chatProcessing &&
          !currentHookRef.current.isListening
        ) {
          currentHookRef.current.startListening()
        }
      }, 300)
      return
    }

    // 常時マイク入力モードがON: 従来どおり無条件で再開
    if (continuousMicListeningMode) {
      logger.log('🔄 AIの発話が完了しました。音声認識を自動的に再開します。')
      setTimeout(() => {
        currentHookRef.current.startListening()
      }, 300) // マイク起動までに少し遅延を入れる
      return
    }

    // 常時マイク入力モードがOFF: 発話後マイク自動再開（p24）
    // 音声認識タイムアウトで常時マイクがOFFにされた後でも、AIが話し終えたら
    // 設定秒数だけ聞き取りをやり直す。手動でOFFにした直後は再開しない。
    const canAutoResume =
      afterSpeakAutoResume && // 設定で有効
      initialSpeechTimeout > 0 && // 0秒なら無効
      !isManualMicOffSuppressed() // 手動OFFから60秒は抑制

    if (!canAutoResume) return

    markAutoResumeSession()
    logger.log(
      '🔄 AIの発話が完了しました。設定時間だけ音声認識を自動的に再開します。'
    )
    setTimeout(() => {
      if (
        !settingsStore.getState().continuousMicListeningMode &&
        !homeStore.getState().isSpeaking &&
        !homeStore.getState().chatProcessing &&
        !currentHookRef.current.isListening
      ) {
        currentHookRef.current.startListening()
      }
    }, 300)
  }, [
    continuousMicListeningMode,
    speechRecognitionMode,
    afterSpeakAutoResume,
    initialSpeechTimeout,
  ])

  // ----- 手動操作の記録（発話後自動再開の抑制に使う） -----
  const toggleListeningWithManualMark = useCallback(async (): Promise<void> => {
    if (currentHookRef.current.isListening) {
      markManualMicOff()
    } else {
      // 手動でONにした場合は抑制を解除して、次の発話後は自動再開させる
      clearManualMicOffSuppression()
      clearAutoResumeSession()
    }
    await currentHookRef.current.toggleListening()
  }, [])

  const stopListeningWithManualMark = useCallback(async (): Promise<void> => {
    markManualMicOff()
    await currentHookRef.current.stopListening()
  }, [])

  // 常時マイク入力モードの変更を監視
  useEffect(() => {
    if (
      continuousMicListeningMode &&
      !currentHookRef.current.isListening &&
      speechRecognitionMode === 'browser' &&
      !homeStore.getState().isSpeaking &&
      !homeStore.getState().chatProcessing &&
      !isSleepingNow()
    ) {
      // 常時マイク入力モードがONになった場合、自動的にマイク入力を開始
      logger.log(
        '🎤 常時マイク入力モードがONになりました。音声認識を開始します。'
      )
      currentHookRef.current.startListening()
    }
  }, [continuousMicListeningMode, speechRecognitionMode])

  // ----- 常時マイク入力モードの定期チェック -----
  // マイクがOFFになっていたら自動でONに戻す
  useEffect(() => {
    // 常時マイク入力モードがOFF、またはブラウザモード以外の場合は何もしない
    if (speechRecognitionMode !== 'browser') {
      return
    }

    const checkAndRestartMic = () => {
      // スリープ時間帯はマイクを開かない。開いていたら閉じる
      if (isSleepingNow()) {
        if (currentHookRef.current.isListening) {
          logger.log('🌙 スリープ時間帯のためマイクを停止します。')
          currentHookRef.current.stopListening()
        }
        return
      }

      if (
        !settingsStore.getState().continuousMicListeningMode &&
        !isWakeModeOn()
      ) {
        return
      }

      const isSpeaking = homeStore.getState().isSpeaking
      const chatProcessing = homeStore.getState().chatProcessing
      const isListening = currentHookRef.current.isListening
      const checkRecognitionActive =
        currentHookRef.current.checkRecognitionActive

      // 判断は restartPolicy に集約（再起動の予約中は叩き直さない）
      const restartPending =
        currentHookRef.current.isRestartPending?.() ?? false
      const decisionInput = {
        isListening,
        isSpeaking,
        isProcessing: chatProcessing,
        isRecognitionActive: Boolean(checkRecognitionActive?.()),
        isRestartPending: restartPending,
        isSleeping: false,
      }

      // マイクがOFFで、発話中でも処理中でもない場合は再開
      if (shouldWatchdogStart(decisionInput) && !restartPending) {
        logger.log(
          '🔄 常時マイク入力モード: マイクがOFFになっていたため、自動で再開します。'
        )
        currentHookRef.current.startListening()
        return
      }

      // isListeningがtrueでも、実際にアクティブでない場合は再起動
      // すでに onend からの再起動待ちなら、二重に叩き直さない。
      // ここを見ないと「停止→100ms→開始」が1秒ごとに走り、動きが止まる
      if (isListening && shouldWatchdogRestart(decisionInput)) {
        if (!decisionInput.isRecognitionActive) {
          logger.log(
            '🔄 常時マイク入力モード: 音声認識が非アクティブのため再起動します。'
          )
          currentHookRef.current.stopListening()
          setTimeout(() => {
            currentHookRef.current.startListening()
          }, 100)
        }
      }
    }

    // 1秒ごとにチェック
    const intervalId = setInterval(checkAndRestartMic, 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [continuousMicListeningMode, speechRecognitionMode])

  // 発話完了時のコールバックを登録
  useEffect(() => {
    // ブラウザモードでのみコールバックを登録
    if (speechRecognitionMode === 'browser') {
      SpeakQueue.onSpeakCompletion(handleSpeakCompletion)

      return () => {
        // コンポーネントのアンマウント時にコールバックを削除
        SpeakQueue.removeSpeakCompletionCallback(handleSpeakCompletion)
      }
    }
  }, [speechRecognitionMode, handleSpeakCompletion])

  // コンポーネントのマウント時に常時マイク入力モードがONの場合は自動的にマイク入力を開始
  useEffect(() => {
    // マウント時の処理（settingsStore.getState()でstale closure回避）
    if (
      settingsStore.getState().continuousMicListeningMode &&
      settingsStore.getState().speechRecognitionMode === 'browser' &&
      !currentHookRef.current.isListening &&
      !homeStore.getState().isSpeaking &&
      !homeStore.getState().chatProcessing
    ) {
      const delayedStart = async () => {
        logger.log('🎤 コンポーネントマウント時に音声認識を自動的に開始します')
        // コンポーネントマウント時に少し遅延させてから開始
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (
          settingsStore.getState().continuousMicListeningMode &&
          !currentHookRef.current.isListening &&
          !homeStore.getState().isSpeaking &&
          !homeStore.getState().chatProcessing
        ) {
          currentHookRef.current.startListening()
        }
      }

      delayedStart()
    }

    return () => {
      // コンポーネントのアンマウント時にマイク入力を停止（ref経由で最新関数を取得）
      if (currentHookRef.current.isListening) {
        currentHookRef.current.stopListening()
      }
    }
  }, []) // マウント時のみ実行（ref経由で最新値を取得）

  // ----- キーボードショートカットの設定 -----
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const shortcut = voiceInputShortcutRef.current
      if (
        !e.repeat &&
        !activeVoiceShortcutRef.current &&
        matchesKeyboardShortcut(e, shortcut) &&
        !currentHookRef.current.isListening
      ) {
        if (
          isEditableKeyboardTarget(e.target) &&
          !hasCommandModifier(shortcut) &&
          e.key.length === 1
        ) {
          return
        }

        e.preventDefault()
        activeVoiceShortcutRef.current = shortcut
        handleStopSpeaking()
        const startPromise = Promise.resolve(
          currentHookRef.current.startListening()
        )
          .then(() => true)
          .catch((error) => {
            logger.error('Failed to start voice input from shortcut:', error)
            return false
          })
        shortcutStartPromiseRef.current = startPromise
        const started = await startPromise
        if (!started) {
          activeVoiceShortcutRef.current = null
          shortcutStartPromiseRef.current = null
        }
      }
    }

    const handleKeyUp = async (e: KeyboardEvent) => {
      const activeShortcut =
        activeVoiceShortcutRef.current ?? voiceInputShortcutRef.current
      if (
        isKeyboardShortcutRelease(e, activeShortcut) &&
        (activeVoiceShortcutRef.current || currentHookRef.current.isListening)
      ) {
        if (
          !activeVoiceShortcutRef.current &&
          isEditableKeyboardTarget(e.target) &&
          !hasCommandModifier(activeShortcut) &&
          e.key.length === 1
        ) {
          return
        }

        e.preventDefault()
        activeVoiceShortcutRef.current = null

        const started = await (shortcutStartPromiseRef.current ??
          Promise.resolve(currentHookRef.current.isListening))
        shortcutStartPromiseRef.current = null
        if (!started) return

        // マイクボタンと同じ動作をさせるため、toggleListeningを使用せず
        // stopListeningを直接呼び出し、テキストが存在する場合は送信する

        // メッセージを先に変数に保存（stopListening後にuserMessageが変わる可能性があるため）
        const message = currentHookRef.current.userMessage.trim()

        // 先に音声認識を停止
        await currentHookRef.current.stopListening()

        const settings = settingsStore.getState()
        const isLiveTranscription =
          !settings.realtimeAPIMode &&
          settings.speechRecognitionMode === 'live-transcription'

        // ライブ文字起こしはstopListening内で確定結果を送信する。
        if (message && !isLiveTranscription) {
          // chatProcessing を true に設定
          homeStore.setState({ chatProcessing: true })
          // メッセージを空にする
          currentHookRef.current.handleInputChange({
            target: { value: '' },
          } as React.ChangeEvent<HTMLTextAreaElement>)
          // 処理を開始
          onChatProcessStart(message)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      activeVoiceShortcutRef.current = null
      shortcutStartPromiseRef.current = null
    }
  }, [handleStopSpeaking, onChatProcessStart])

  // 現在のモードに基づいて適切なフックのAPIを返す
  return {
    userMessage: currentHook.userMessage,
    isListening: currentHook.isListening,
    isProcessing:
      'isProcessing' in currentHook ? currentHook.isProcessing : false,
    silenceTimeoutRemaining: currentHook.silenceTimeoutRemaining,
    handleInputChange: currentHook.handleInputChange,
    handleSendMessage: currentHook.handleSendMessage,
    toggleListening: toggleListeningWithManualMark,
    handleStopSpeaking,
    startListening: currentHook.startListening,
    stopListening: stopListeningWithManualMark,
  }
}
