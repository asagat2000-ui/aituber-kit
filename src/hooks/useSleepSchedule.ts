import { useEffect, useSyncExternalStore } from 'react'
import settingsStore from '@/features/stores/settings'
import { getSleepWindowKey } from '@/features/sleep/sleepSchedule'
import {
  SleepState,
  getSleepState,
  subscribeSleep,
  updateSleepWindow,
} from '@/features/sleep/sleepStore'

/**
 * スリープ時間帯の判定フック
 *
 * iOS はスリープやバックグラウンドでタイマーが止まるため、1秒間隔には頼らず
 * 30秒間隔＋画面復帰（visibilitychange / focus）で必ず判定し直す。
 */
export function useSleepSchedule(): SleepState {
  const sleepModeEnabled = settingsStore((s) => s.sleepModeEnabled)
  const sleepStartTime = settingsStore((s) => s.sleepStartTime)
  const sleepEndTime = settingsStore((s) => s.sleepEndTime)

  const state = useSyncExternalStore(
    subscribeSleep,
    getSleepState,
    getSleepState
  )

  useEffect(() => {
    if (!sleepModeEnabled) {
      updateSleepWindow(null)
      return
    }

    const evaluate = () => {
      updateSleepWindow(
        getSleepWindowKey(new Date(), sleepStartTime, sleepEndTime)
      )
    }

    evaluate()

    const intervalId = setInterval(evaluate, 30 * 1000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') evaluate()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', evaluate)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', evaluate)
    }
  }, [sleepModeEnabled, sleepStartTime, sleepEndTime])

  return state
}
