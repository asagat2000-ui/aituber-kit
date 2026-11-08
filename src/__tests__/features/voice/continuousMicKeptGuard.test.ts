import fs from 'fs'
import path from 'path'

/**
 * p44: 無音タイマーが「常時マイク入力モード」をOFFに保存しないことの検査。
 *
 * これをOFFに保存していたため、起動するたびに灰色（未開始）へ戻り、
 * 「起動しただけでマイクが赤くならない」状態になっていた。
 * 設定は利用者の意思でしか変えない。
 */
const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe('常時マイク設定の保持', () => {
  const files = [
    'hooks/useBrowserSpeechRecognition.ts',
    'hooks/useSilenceDetection.ts',
  ]

  it.each(files)('%s が常時マイク設定を false に保存していない', (f) => {
    const src = read(f)
    expect(src).not.toMatch(
      /setState\(\s*\{\s*continuousMicListeningMode:\s*false/
    )
  })

  it('無音タイムアウト側は設定を見て停止可否を決めている', () => {
    const src = read('hooks/useBrowserSpeechRecognition.ts')
    expect(src).toMatch(/wasContinuous/)
  })

  it('無音でも設定を保持する旨がコードに残っている', () => {
    expect(read('hooks/useSilenceDetection.ts')).toMatch(/p44/)
  })
})
