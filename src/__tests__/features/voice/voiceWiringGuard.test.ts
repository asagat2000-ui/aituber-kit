import fs from 'fs'
import path from 'path'

/**
 * 音声認識に渡す関数の「作り方」を検査する。
 *
 * 音声認識は渡された関数の同一性で動作を切り替えるため、
 * JSX や引数の中にその場で関数を書くと、描き直すたびに
 * 別人の関数になり、開始と停止を延々と繰り返す（p40の不具合）。
 *
 * 実ブラウザでの再現が難しいため、ここで配線そのものを固定する。
 */
describe('音声認識への関数の渡し方', () => {
  const read = (p: string) =>
    fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf-8')

  it('入力欄は useWakeGate を通した関数を渡している', () => {
    const src = read('components/messageInputContainer.tsx')
    expect(src).toContain('useWakeGate')
    expect(src).toMatch(/onChatProcessStart:\s*gatedOnChatProcessStart/)
  })

  it('入力欄がその場で関数を書いていない（同一性が変わる書き方の禁止）', () => {
    const src = read('components/messageInputContainer.tsx')
    // 型定義の `onChatProcessStart: (text) => void` は対象外。
    // useVoiceRecognition に渡している箇所だけを見る
    const start = src.indexOf('useVoiceRecognition({')
    expect(start).toBeGreaterThan(-1)
    const call = src.slice(start, src.indexOf('})', start) + 2)
    expect(call).not.toMatch(/onChatProcessStart:\s*(\(|function|async)/)
  })

  it('useWakeGate は useCallback で同一性を固定している', () => {
    const src = read('features/voice/useWakeGate.ts')
    expect(src).toContain('useCallback')
    expect(src).toMatch(/\},\s*\[\]\)/)
  })

  it('関所はマイクを動かすコードを持たない', () => {
    for (const f of [
      'features/voice/wakeGate.ts',
      'features/voice/useWakeGate.ts',
    ]) {
      const src = read(f)
      for (const forbidden of [
        'startListening',
        'stopListening',
        'useBrowserSpeechRecognition',
        'getUserMedia',
      ]) {
        expect(src).not.toContain(forbidden)
      }
    }
  })
})
