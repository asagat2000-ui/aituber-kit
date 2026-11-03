import {
  getSleepWindowKey,
  isWithinSleepWindow,
  parseTimeToMinutes,
} from '@/features/sleep/sleepSchedule'

function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
) {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

describe('スリープ時間帯の判定', () => {
  it('時刻文字列を分に変換できる', () => {
    expect(parseTimeToMinutes('23:00')).toBe(1380)
    expect(parseTimeToMinutes('06:30')).toBe(390)
    expect(parseTimeToMinutes('0:05')).toBe(5)
  })

  it('不正な時刻は null', () => {
    expect(parseTimeToMinutes('24:00')).toBeNull()
    expect(parseTimeToMinutes('23:60')).toBeNull()
    expect(parseTimeToMinutes('abc')).toBeNull()
    expect(parseTimeToMinutes('')).toBeNull()
  })

  it('日を跨ぐ時間帯（23:00〜06:00）を判定できる', () => {
    expect(isWithinSleepWindow(at(2026, 11, 4, 23, 30), '23:00', '06:00')).toBe(
      true
    )
    expect(isWithinSleepWindow(at(2026, 11, 5, 2, 0), '23:00', '06:00')).toBe(
      true
    )
    expect(isWithinSleepWindow(at(2026, 11, 5, 6, 0), '23:00', '06:00')).toBe(
      false
    )
    expect(isWithinSleepWindow(at(2026, 11, 4, 22, 59), '23:00', '06:00')).toBe(
      false
    )
  })

  it('同日の時間帯（13:00〜14:00）を判定できる', () => {
    expect(isWithinSleepWindow(at(2026, 11, 4, 13, 30), '13:00', '14:00')).toBe(
      true
    )
    expect(isWithinSleepWindow(at(2026, 11, 4, 14, 0), '13:00', '14:00')).toBe(
      false
    )
    expect(isWithinSleepWindow(at(2026, 11, 4, 12, 59), '13:00', '14:00')).toBe(
      false
    )
  })

  it('開始と終了が同じ時刻なら無効', () => {
    expect(isWithinSleepWindow(at(2026, 11, 4, 23, 0), '23:00', '23:00')).toBe(
      false
    )
  })

  it('日を跨ぐ時間帯のキーは開始日になる', () => {
    expect(getSleepWindowKey(at(2026, 11, 4, 23, 30), '23:00', '06:00')).toBe(
      '2026-11-04'
    )
    // 翌日の未明でも、同じ時間帯として同じキーを返す
    expect(getSleepWindowKey(at(2026, 11, 5, 2, 0), '23:00', '06:00')).toBe(
      '2026-11-04'
    )
    expect(getSleepWindowKey(at(2026, 11, 5, 12, 0), '23:00', '06:00')).toBe(
      null
    )
  })
})
