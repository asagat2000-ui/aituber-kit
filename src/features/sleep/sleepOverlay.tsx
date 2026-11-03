import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import settingsStore from '@/features/stores/settings'
import { useSleepSchedule } from '@/hooks/useSleepSchedule'
import { isSleepingNow, wakeUpFromSleep } from '@/features/sleep/sleepStore'

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`
}

/**
 * スリープ中の暗転オーバーレイ
 * タップすると、そのスリープ時間帯の間だけ起床する。
 */
export default function SleepOverlay(): JSX.Element | null {
  const { t } = useTranslation()
  useSleepSchedule()

  const sleepScreenDim = settingsStore((s) => s.sleepScreenDim)
  const [clock, setClock] = useState(() => formatClock(new Date()))

  const sleeping = isSleepingNow()

  useEffect(() => {
    if (!sleeping) return
    setClock(formatClock(new Date()))
    const intervalId = setInterval(
      () => setClock(formatClock(new Date())),
      10 * 1000
    )
    return () => clearInterval(intervalId)
  }, [sleeping])

  if (!sleeping || !sleepScreenDim) return null

  return (
    <div
      data-testid="sleep-overlay"
      onPointerDown={() => wakeUpFromSleep()}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 text-white select-none"
    >
      <div className="text-6xl font-light tracking-widest tabular-nums">
        {clock}
      </div>
      <div className="mt-6 text-sm text-white/60">{t('SleepTapToWake')}</div>
    </div>
  )
}
