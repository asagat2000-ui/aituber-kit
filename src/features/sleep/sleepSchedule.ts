/**
 * スリープ時間帯の判定（純粋関数）
 *
 * 「23:00〜06:00」のような日を跨ぐ時間帯と、「13:00〜14:00」のような
 * 同日の時間帯の両方を扱う。開始と終了が同じ時刻のときは無効（1日中スリープの事故防止）。
 */

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** "23:00" 形式を 0:00 からの分に変換する。不正な形式は null */
export function parseTimeToMinutes(value: string): number | null {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!matched) return null
  const hours = Number(matched[1])
  const minutes = Number(matched[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23) return null
  if (minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * スリープ中のとき、そのスリープ時間帯の開始日を "YYYY-MM-DD" で返す。
 * スリープ中でない場合や設定が無効な場合は null。
 *
 * 開始日をキーにすることで「一度タップで起床したら、その時間帯の間は起きたまま」を
 * 判定できる（日を跨いでも同じキーになる）。
 */
export function getSleepWindowKey(
  now: Date,
  start: string,
  end: string
): string | null {
  const startMinutes = parseTimeToMinutes(start)
  const endMinutes = parseTimeToMinutes(end)
  if (startMinutes === null || endMinutes === null) return null
  // 開始と終了が同じ＝時間帯が成立しない
  if (startMinutes === endMinutes) return null

  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  // 同日の時間帯（例: 13:00〜14:00）
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
      ? toDateKey(now)
      : null
  }

  // 日を跨ぐ時間帯（例: 23:00〜06:00）
  if (currentMinutes >= startMinutes) return toDateKey(now)
  if (currentMinutes < endMinutes) {
    const previousDay = new Date(now)
    previousDay.setDate(previousDay.getDate() - 1)
    return toDateKey(previousDay)
  }
  return null
}

/** 指定時刻がスリープ時間帯に入っているか */
export function isWithinSleepWindow(
  now: Date,
  start: string,
  end: string
): boolean {
  return getSleepWindowKey(now, start, end) !== null
}
