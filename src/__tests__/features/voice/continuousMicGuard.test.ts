import fs from 'fs'
import path from 'path'

/**
 * 「常時マイク入力モード」を勝手にOFFにする処理が戻ってきたら落とす。
 * これが復活すると、5秒後にマイクが閉じて以後ずっと無反応になる。
 */
describe('常時マイク設定を書き換えないこと', () => {
  const read = (p: string) =>
    fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf-8')

  it('無音検出が continuousMicListeningMode を false にしない', () => {
    const src = read('hooks/useSilenceDetection.ts')
    expect(src).not.toMatch(/continuousMicListeningMode:\s*false/)
  })

  it('音声認識フックが continuousMicListeningMode を false にしない', () => {
    const src = read('hooks/useBrowserSpeechRecognition.ts')
    expect(src).not.toMatch(/continuousMicListeningMode:\s*false/)
  })

  it('無音検出は共通の判断関数を使う', () => {
    const src = read('hooks/useSilenceDetection.ts')
    expect(src).toContain('shouldStopOnNoSpeech')
    expect(src).toContain('shouldArmNoSpeechTimer')
  })
})
