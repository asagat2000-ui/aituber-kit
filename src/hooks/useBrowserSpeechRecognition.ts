import { logger } from '@/lib/logger'
import {
  clearAutoResumeSession,
  isAutoResumeSession,
} from '@/features/voice/autoResumeState'
import {
  containsWakePhrase,
  enterConversation,
  isWakeStandby,
  setWakeStandby,
} from '@/features/voice/wakeWord'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getVoiceLanguageCode } from '@/utils/voiceLanguage'
import settingsStore from '@/features/stores/settings'
import toastStore from '@/features/stores/toast'
import homeStore from '@/features/stores/home'
import { useTranslation } from 'react-i18next'
import { useSilenceDetection } from './useSilenceDetection'
import { SpeakQueue } from '@/features/messages/speakQueue'
import {
  isMicPermissionGranted,
  markMicPermissionGranted,
} from '@/features/voice/micPermission'
import { updateVoiceDebug } from '@/features/voice/voiceDebugState'

/**
 * ブラウザの音声認識APIを使用するためのカスタムフック
 */
export function useBrowserSpeechRecognition(
  onChatProcessStart: (text: string) => void
) {
  const { t } = useTranslation()
  const selectLanguage = settingsStore((s) => s.selectLanguage)
  const initialSpeechTimeout = settingsStore((s) => s.initialSpeechTimeout)

  // ----- 状態管理 -----
  const [userMessage, setUserMessage] = useState('')
  const [isListening, setIsListening] = useState(false)
  const isListeningRef = useRef(false)

  // ----- 音声認識関連 -----
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(null)
  const transcriptRef = useRef('')
  const speechDetectedRef = useRef<boolean>(false)
  const recognitionStartTimeRef = useRef<number>(0)
  const initialSpeechCheckTimerRef = useRef<NodeJS.Timeout | null>(null)
  // ----- 競合状態防止: 再起動タイマーの追跡 -----
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // ----- 音声認識が実際に動作中かどうかを追跡 -----
  // true: onstart発火済み（動作中）, false: onend発火済み（停止中）
  const recognitionActiveRef = useRef<boolean>(false)
  // ----- 開始処理中かどうかを追跡（排他制御用） -----
  const isStartingRef = useRef<boolean>(false)

  // ----- デバッグ用の再起動回数 -----
  const restartCountRef = useRef(0)

  // ----- 会話モードの無音タイマー -----
  const conversationTimerRef = useRef<NodeJS.Timeout | null>(null)

  // ----- キーボードトリガー関連 -----
  const keyPressStartTime = useRef<number | null>(null)
  const isKeyboardTriggered = useRef(false)

  // ----- 無音検出フックを使用 -----
  const {
    silenceTimeoutRemaining,
    clearSilenceDetection,
    startSilenceDetection,
    updateSpeechTimestamp,
    isSpeechEnded,
  } = useSilenceDetection({
    onTextDetected: (text: string) => {
      // 待機中（呼びかけ待ち）は勝手に送信しない
      if (isWakeStandby()) return
      onChatProcessStart(text)
    },
    transcriptRef,
    setUserMessage,
    speechDetectedRef,
  })

  // ----- 初期音声検出タイマーをクリアする関数 -----
  const clearInitialSpeechCheckTimer = useCallback(() => {
    if (initialSpeechCheckTimerRef.current) {
      clearTimeout(initialSpeechCheckTimerRef.current)
      initialSpeechCheckTimerRef.current = null
    }
  }, [])

  // ----- 音声未検出時の停止処理を実行する共通関数 (Requirement 5.1) -----
  const handleNoSpeechTimeout = useCallback(
    async (stopListeningFn: () => Promise<void>) => {
      logger.log(
        `⏱️ ${initialSpeechTimeout}秒間音声が検出されませんでした。音声認識を停止します。`
      )
      await stopListeningFn()

      // 発話後の自動再開（p24）で始まった聞き取りかどうか
      // 自動再開が設定時間を過ぎただけの場合はトーストを出さず静かに終了する
      const wasAutoResume = isAutoResumeSession()
      clearAutoResumeSession()

      // 待機中は無音が普通なので、常時マイクをOFFにせず静かに再開する
      if (isWakeStandby()) {
        logger.log(
          '🌙 ウェイクワード待機中のため、常時マイク設定は変更しません。'
        )
        clearSilenceDetection()
        return
      }

      // 常時マイク入力モードをオフに設定
      if (settingsStore.getState().continuousMicListeningMode) {
        logger.log('🔇 音声未検出により常時マイク入力モードをOFFに設定します。')
        settingsStore.setState({ continuousMicListeningMode: false })
      }

      if (wasAutoResume) {
        logger.log(
          '🔇 発話後の自動再開が設定時間を過ぎたため、音声認識を停止しました。'
        )
        return
      }

      toastStore.getState().addToast({
        message: t('Toasts.NoSpeechDetected'),
        type: 'info',
        tag: 'no-speech-detected',
      })
    },
    [initialSpeechTimeout, t]
  )

  // ----- 初期音声検出タイマーをセットアップする共通関数 (Requirement 5.1) -----
  const setupInitialSpeechTimer = useCallback(
    (stopListeningFn: () => Promise<void>) => {
      // 既存のタイマーをクリアしてから新しいタイマーを設定 (Requirement 5.2)
      clearInitialSpeechCheckTimer()

      // 呼びかけ待ちの間は無音が普通なので、初期無音タイマーを張らない。
      // 張ると5秒ごとにマイクが落ち、触るたびに再開する往復が起きる。
      if (initialSpeechTimeout > 0 && !isWakeStandby()) {
        initialSpeechCheckTimerRef.current = setTimeout(() => {
          if (!speechDetectedRef.current && isListeningRef.current) {
            handleNoSpeechTimeout(stopListeningFn)
          }
        }, initialSpeechTimeout * 1000)
      }
    },
    [initialSpeechTimeout, clearInitialSpeechCheckTimer, handleNoSpeechTimeout]
  )

  // ----- 会話モードを終える無音タイマー -----
  const clearConversationTimer = useCallback(() => {
    if (conversationTimerRef.current) {
      clearTimeout(conversationTimerRef.current)
      conversationTimerRef.current = null
    }
  }, [])

  const armConversationTimer = useCallback(() => {
    clearConversationTimer()
    const settings = settingsStore.getState()
    if (!settings.wakeWordEnabled) return
    if (isWakeStandby()) return

    const seconds = settings.wakeWordConversationTimeout
    if (!(seconds > 0)) return

    conversationTimerRef.current = setTimeout(() => {
      logger.log('🌙 会話モードの無音タイムアウト。呼びかけ待ちに戻ります。')
      setWakeStandby(true)
      clearInitialSpeechCheckTimer()
      clearSilenceDetection()
      transcriptRef.current = ''
      setUserMessage('')
      speechDetectedRef.current = false
    }, seconds * 1000)
  }, [clearConversationTimer])

  // ----- 音声認識停止処理 -----
  const stopListening = useCallback(async () => {
    // 保留中の再起動タイマーをキャンセル (競合状態防止)
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }

    // 各種タイマーをクリア
    clearSilenceDetection()
    clearInitialSpeechCheckTimer()
    clearConversationTimer()

    // リスニング状態を更新
    isListeningRef.current = false
    setIsListening(false)

    if (!recognition) return

    // 音声認識を停止
    try {
      recognition.stop()
    } catch (error) {
      logger.error('Error stopping recognition:', error)
    }

    // キーボードトリガーの場合の処理
    const trimmedTranscriptRef = transcriptRef.current.trim()
    if (isKeyboardTriggered.current) {
      const pressDuration = Date.now() - (keyPressStartTime.current || 0)
      // 押してから1秒以上 かつ 文字が存在する場合のみ送信
      // 無音検出による自動送信が既に行われていない場合のみ送信する
      if (pressDuration >= 1000 && trimmedTranscriptRef && !isSpeechEnded()) {
        onChatProcessStart(trimmedTranscriptRef)
        setUserMessage('')
      }
      isKeyboardTriggered.current = false
    }
  }, [
    clearSilenceDetection,
    clearInitialSpeechCheckTimer,
    clearConversationTimer,
    recognition,
    isSpeechEnded,
    onChatProcessStart,
  ])

  // ----- マイク権限確認 -----
  const checkMicrophonePermission = useCallback(async (): Promise<boolean> => {
    // Firefoxの場合はエラーメッセージを表示して終了
    if (navigator.userAgent.toLowerCase().includes('firefox')) {
      toastStore.getState().addToast({
        message: t('Toasts.FirefoxNotSupported'),
        type: 'error',
        tag: 'microphone-permission-error-firefox',
      })
      return false
    }

    // このセッションで一度許可済みなら、デバイスを開き直さない。
    // iOS では開くたびに描画が止まり、アバターがカクつく原因になる。
    if (isMicPermissionGranted()) return true

    try {
      // getUserMediaを直接呼び出し、ブラウザのネイティブ許可モーダルを表示
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      markMicPermissionGranted()
      return true
    } catch (error) {
      // ユーザーが明示的に拒否した場合や、その他のエラーの場合
      logger.error('Microphone permission error:', error)
      toastStore.getState().addToast({
        message: t('Toasts.MicrophonePermissionDenied'),
        type: 'error',
        tag: 'microphone-permission-error',
      })
      return false
    }
  }, [t])

  // ----- 音声認識開始処理 -----
  const startListening = useCallback(async () => {
    // 排他制御: 既に開始処理中の場合は何もしない
    if (isStartingRef.current) {
      logger.log('Recognition start already in progress, skipping')
      return
    }
    isStartingRef.current = true

    // 保留中の再起動タイマーをキャンセル (onendハンドラとの競合状態防止)
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }

    try {
      const hasPermission = await checkMicrophonePermission()
      if (!hasPermission) {
        isStartingRef.current = false
        return
      }

      if (!recognition) {
        isStartingRef.current = false
        return
      }

      // 既に認識が開始されている場合は、onendイベントを待って停止を確認
      // ただし自然終了（onend済み）なら待つ必要がない。毎回500ms固まるのを避ける
      if (isListeningRef.current && recognitionActiveRef.current) {
        await new Promise<void>((resolve) => {
          let timeoutId: NodeJS.Timeout

          const onEndHandler = () => {
            clearTimeout(timeoutId)
            recognition.removeEventListener('end', onEndHandler)
            resolve()
          }

          timeoutId = setTimeout(() => {
            recognition.removeEventListener('end', onEndHandler)
            logger.log('Recognition stop timeout, forcing resolve')
            resolve()
          }, 500) // 500ms でタイムアウト

          recognition.addEventListener('end', onEndHandler)
          try {
            recognition.stop()
          } catch (err) {
            clearTimeout(timeoutId)
            recognition.removeEventListener('end', onEndHandler)
            resolve()
          }
        })
        // 状態をリセット
        isListeningRef.current = false
        setIsListening(false)
      }

      // トランスクリプトをリセット
      transcriptRef.current = ''
      setUserMessage('')

      try {
        // 音声認識がまだ動作中の場合は、onendを待つ
        if (recognitionActiveRef.current) {
          logger.log('Recognition still active, waiting for onend...')
          await new Promise<void>((resolve) => {
            let timeoutId: NodeJS.Timeout
            const onEndHandler = () => {
              clearTimeout(timeoutId)
              recognition.removeEventListener('end', onEndHandler)
              resolve()
            }
            timeoutId = setTimeout(() => {
              recognition.removeEventListener('end', onEndHandler)
              logger.log('Recognition active wait timeout, forcing resolve')
              resolve()
            }, 500)
            recognition.addEventListener('end', onEndHandler)
          })
        }

        recognition.start()
        logger.log('Recognition started successfully')
        // リスニング状態を更新
        isListeningRef.current = true
        setIsListening(true)
        updateVoiceDebug({ mic: true, standby: isWakeStandby(), error: '' })
      } catch (error) {
        logger.error('Error starting recognition:', error)

        // InvalidStateErrorの場合は、既に開始されているとみなす
        if (
          error instanceof DOMException &&
          error.name === 'InvalidStateError'
        ) {
          logger.log('Recognition is already running, skipping retry')
          // 既に実行中なので、リスニング状態を更新する
          isListeningRef.current = true
          setIsListening(true)

          // onstart イベントハンドラと同様の処理を手動で実行
          logger.log('Speech recognition started (manually triggered)')
          recognitionStartTimeRef.current = Date.now()
          speechDetectedRef.current = false

          // 初期音声検出タイマー設定 (Requirement 5.2: 共通関数を使用)
          setupInitialSpeechTimer(stopListening)

          // 無音検出開始
          startSilenceDetection(stopListening)
        } else {
          // その他のエラーの場合のみ再試行
          setTimeout(() => {
            try {
              if (recognition) {
                // 一度確実に停止を試みる
                try {
                  recognition.stop()
                  // 停止後に短い遅延
                  setTimeout(() => {
                    recognition.start()
                    logger.log('Recognition started on retry')
                    isListeningRef.current = true
                    setIsListening(true)
                  }, 100)
                } catch (stopError) {
                  // 停止できなかった場合は直接スタート
                  try {
                    recognition.start()
                    logger.log('Recognition started on retry without stopping')
                    isListeningRef.current = true
                    setIsListening(true)
                  } catch (startError) {
                    logger.error(
                      'Failed to start recognition on retry:',
                      startError
                    )
                    isListeningRef.current = false
                    setIsListening(false)
                  }
                }
              }
            } catch (retryError) {
              logger.error('Failed to start recognition on retry:', retryError)
              isListeningRef.current = false
              setIsListening(false)
              return
            }
          }, 300)
        }
      }
    } finally {
      // 排他制御を解除
      isStartingRef.current = false
    }
  }, [recognition, checkMicrophonePermission])

  // ----- 音声認識トグル処理 -----
  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening()
    } else {
      keyPressStartTime.current = Date.now()
      isKeyboardTriggered.current = true
      startListening()
      // AIの発話を停止
      homeStore.setState({ isSpeaking: false })
    }
  }, [startListening, stopListening])

  // ----- メッセージ送信 -----
  const handleSendMessage = useCallback(async () => {
    const trimmedMessage = userMessage.trim()
    if (trimmedMessage) {
      // AIの発話を停止
      homeStore.setState({ isSpeaking: false })
      SpeakQueue.stopAll()

      // マイク入力を停止（常時音声入力モード時も自動送信と同様に停止）
      await stopListening()

      onChatProcessStart(trimmedMessage)
      setUserMessage('')
    }
  }, [userMessage, onChatProcessStart, stopListening])

  // ----- メッセージ入力 -----
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setUserMessage(e.target.value)
    },
    []
  )

  // ----- 音声認識オブジェクトの初期化とイベントハンドラ設定 -----
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      logger.error('Speech Recognition API is not supported in this browser')
      toastStore.getState().addToast({
        message: t('Toasts.SpeechRecognitionNotSupported'),
        type: 'error',
        tag: 'speech-recognition-not-supported',
      })
      return
    }

    const newRecognition = new SpeechRecognition()
    newRecognition.lang = getVoiceLanguageCode(selectLanguage)
    newRecognition.continuous = true
    newRecognition.interimResults = true

    // ----- イベントハンドラの設定 -----

    // 音声認識開始時
    newRecognition.onstart = () => {
      logger.log('Speech recognition started')
      recognitionStartTimeRef.current = Date.now()
      speechDetectedRef.current = false
      // 音声認識が実際に動作中であることを記録
      recognitionActiveRef.current = true

      // 初期音声検出タイマー設定 (Requirement 5.2: 共通関数を使用)
      setupInitialSpeechTimer(stopListening)

      // 無音検出開始
      startSilenceDetection(stopListening)
    }

    // 音声入力検出時
    newRecognition.onspeechstart = () => {
      logger.log('🗣️ 音声入力を検出しました（onspeechstart）')
      // ここではタイマーをリセットするだけで、speechDetectedRefは設定しない
      updateSpeechTimestamp()
    }

    // 音量レベル追跡用変数
    let lastTranscriptLength = 0

    // 音声認識結果が得られたとき
    newRecognition.onresult = (event) => {
      if (!isListeningRef.current) return

      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('')
      updateVoiceDebug({
        mic: true,
        standby: isWakeStandby(),
        lastEvent: 'onresult',
        lastText: transcript.slice(0, 40),
      })

      // 有意な変化があるかチェック
      const isSignificantChange =
        transcript.trim().length > lastTranscriptLength
      lastTranscriptLength = transcript.trim().length

      // 待機中は「呼びかけ」だけを見る。会話は始めない
      if (isWakeStandby()) {
        const phrases = settingsStore.getState().wakeWordPhrases
        if (containsWakePhrase(transcript, phrases)) {
          logger.log('🌞 呼びかけを検出しました。会話を開始します。')
          enterConversation()
          transcriptRef.current = ''
          setUserMessage('')
          updateSpeechTimestamp()
          speechDetectedRef.current = true
          return
        }
        // 呼びかけ以外は表示もしない・保持もしない
        transcriptRef.current = ''
        setUserMessage('')
        return
      }

      if (isSignificantChange) {
        logger.log('🎤 有意な音声を検出しました（トランスクリプト変更あり）')
        updateSpeechTimestamp()
        armConversationTimer()
        speechDetectedRef.current = true
        // 発話を検知したので自動再開セッションは終了
        clearAutoResumeSession()
      } else {
        logger.log(
          '🔇 バックグラウンドノイズを無視します（トランスクリプト変更なし）'
        )
      }

      transcriptRef.current = transcript
      setUserMessage(transcript)
    }

    // 音声入力終了時
    newRecognition.onspeechend = () => {
      logger.log(
        '🛑 音声入力が終了しました（onspeechend）。無音検出タイマーが動作中です。'
      )
    }

    // 音声認識終了時
    newRecognition.onend = () => {
      logger.log('Recognition ended')
      // 音声認識が停止したことを記録
      recognitionActiveRef.current = false
      clearSilenceDetection()
      clearInitialSpeechCheckTimer()

      // isListeningRef.currentがtrueの場合は再開
      if (isListeningRef.current) {
        logger.log('Restarting speech recognition...')
        updateVoiceDebug({
          mic: false,
          standby: isWakeStandby(),
          restarts: (restartCountRef.current += 1),
          lastEvent: 'onend→再起動',
        })
        // 再起動タイマーをrefに保存して追跡 (競合状態防止)
        restartTimeoutRef.current = setTimeout(() => {
          // setTimeout実行時に再度状態を確認 (競合状態防止)
          if (isListeningRef.current) {
            startListening()
          }
          restartTimeoutRef.current = null
        }, 1000)
      }
    }

    // 音声認識エラー時
    newRecognition.onerror = (event) => {
      logger.error('Speech recognition error:', event.error)
      updateVoiceDebug({ error: String(event.error), lastEvent: 'onerror' })

      // 呼びかけ待ちは「静かなのが正常」。ここで止めるとマイクが落ちる
      if (event.error === 'no-speech' && isWakeStandby()) {
        clearSilenceDetection()
        clearInitialSpeechCheckTimer()
        return
      }

      // no-speechエラーの場合
      if (event.error === 'no-speech' && isListeningRef.current) {
        // 初回音声検出されていない場合のみ、累積時間をチェック
        if (!speechDetectedRef.current && initialSpeechTimeout > 0) {
          // 認識開始からの経過時間を計算
          const elapsedTime =
            (Date.now() - recognitionStartTimeRef.current) / 1000
          logger.log(
            `音声未検出の累積時間: ${elapsedTime.toFixed(1)}秒 / 設定: ${initialSpeechTimeout}秒`
          )

          // 設定された初期音声タイムアウトを超えた場合は、再起動せずに終了
          if (elapsedTime >= initialSpeechTimeout) {
            clearSilenceDetection()
            clearInitialSpeechCheckTimer()
            // 共通関数を使用 (Requirement 5.3)
            handleNoSpeechTimeout(stopListening)
            return
          }
        }

        // 音声が既に検出されている場合、または初期タイムアウトに達していない場合は
        // onendハンドラに再起動を委ねる（直接start()を呼ぶと競合状態が発生するため）
        if (
          isListeningRef.current &&
          !homeStore.getState().chatProcessing &&
          (settingsStore.getState().continuousMicListeningMode ||
            settingsStore.getState().wakeWordEnabled ||
            isKeyboardTriggered.current)
        ) {
          logger.log('No speech detected, will restart via onend handler...')
          // onendハンドラが自動的に再起動する
        } else {
          logger.log(
            '音声認識の再起動をスキップします（常時マイクモードがオフまたは他の条件を満たさない）'
          )
          isListeningRef.current = false
          setIsListening(false)
        }
      } else {
        // その他のエラーの場合は通常の終了処理
        clearSilenceDetection()
        clearInitialSpeechCheckTimer()
        stopListening()
      }
    }

    setRecognition(newRecognition)

    // クリーンアップ関数
    return () => {
      // 保留中の再起動タイマーをクリア
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current)
        restartTimeoutRef.current = null
      }
      try {
        if (newRecognition) {
          newRecognition.onstart = null
          newRecognition.onspeechstart = null
          newRecognition.onresult = null
          newRecognition.onspeechend = null
          newRecognition.onend = null
          newRecognition.onerror = null
          newRecognition.abort()
        }
      } catch (error) {
        logger.error('Error cleaning up speech recognition:', error)
      }
      clearSilenceDetection()
      clearInitialSpeechCheckTimer()
    }
  }, [
    selectLanguage,
    initialSpeechTimeout,
    t,
    // stopListening,
    clearSilenceDetection,
    clearInitialSpeechCheckTimer,
    startSilenceDetection,
    updateSpeechTimestamp,
    setupInitialSpeechTimer,
    handleNoSpeechTimeout,
  ])

  // ----- 音声認識が実際にアクティブかチェックする関数 -----
  const checkRecognitionActive = useCallback(() => {
    // onstart発火済みでonend未発火なら動作中
    return recognitionActiveRef.current
  }, [])

  // onend からの再起動待ちかどうか。
  // 待っている間に外から二重に再起動すると、1秒ごとに叩き直す往復になる
  const isRestartPending = useCallback(
    () => restartTimeoutRef.current !== null,
    []
  )

  // 戻り値オブジェクトをメモ化（Requirement 1.1, 1.4）
  const returnValue = useMemo(
    () => ({
      userMessage,
      isListening,
      silenceTimeoutRemaining,
      handleInputChange,
      handleSendMessage,
      toggleListening,
      startListening,
      stopListening,
      checkRecognitionActive,
      isRestartPending,
    }),
    [
      userMessage,
      isListening,
      silenceTimeoutRemaining,
      handleInputChange,
      handleSendMessage,
      toggleListening,
      startListening,
      stopListening,
      checkRecognitionActive,
    ]
  )

  return returnValue
}
