/**
 * スリープ状態の共有ストア
 *
 * アイドル発話・音声認識・画面オーバーレイの複数箇所から同じ判定を参照するため、
 * React 外からも読める軽量ストアとして持つ（zustand ではなく useSyncExternalStore）。
 */

export type SleepState = {
  /** 現在スリープ時間帯に入っているか（設定と時刻のみで決まる） */
  sleeping: boolean
  /** 現在のスリープ時間帯のキー（開始日）。スリープ外は null */
  windowKey: string | null
  /** 手動で起床したスリープ時間帯のキー */
  wokeKey: string | null
}

const initialState: SleepState = {
  sleeping: false,
  windowKey: null,
  wokeKey: null,
}

let state: SleepState = initialState
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((listener) => listener())
}

export function getSleepState(): SleepState {
  return state
}

export function subscribeSleep(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 時刻判定の結果を反映する */
export function updateSleepWindow(windowKey: string | null): void {
  const sleeping = windowKey !== null
  const nextWokeKey = sleeping ? state.wokeKey : null
  if (
    state.sleeping === sleeping &&
    state.windowKey === windowKey &&
    state.wokeKey === nextWokeKey
  ) {
    return
  }
  state = { sleeping, windowKey, wokeKey: nextWokeKey }
  emit()
}

/** タップで起床する（そのスリープ時間帯の間だけ有効） */
export function wakeUpFromSleep(): void {
  if (!state.sleeping) return
  if (state.wokeKey === state.windowKey) return
  state = { ...state, wokeKey: state.windowKey }
  emit()
}

/**
 * 実際にスリープ扱いすべきか。
 * スリープ時間帯でも、手動で起床していれば false になる。
 */
export function isSleepingNow(): boolean {
  return state.sleeping && state.wokeKey !== state.windowKey
}

/** テスト用: 状態を初期化する */
export function resetSleepStateForTest(): void {
  state = initialState
  emit()
}
