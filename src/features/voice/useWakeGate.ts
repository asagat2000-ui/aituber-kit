import { useCallback, useEffect, useRef } from 'react'
import { passWakeGate } from './wakeGate'

/**
 * 呼びかけの関所を通した送信関数を作る。
 *
 * ここで返す関数の「同一性」は絶対に変えてはいけない。
 * 音声認識フックはこの関数を依存配列に入れており、
 * 毎レンダー新しい関数を渡すと、認識の開始と停止が
 * 延々と繰り返されてマイクが定まらなくなる（起動しない・カクつく）。
 *
 * そのため、渡された関数は ref に逃がし、
 * 返す関数は useCallback(..., []) で固定する。
 */
export function useWakeGate(onSend: (text: string) => void) {
  const sendRef = useRef(onSend)

  useEffect(() => {
    sendRef.current = onSend
  }, [onSend])

  return useCallback((text: string) => {
    if (!passWakeGate(text)) return
    sendRef.current(text)
  }, [])
}
