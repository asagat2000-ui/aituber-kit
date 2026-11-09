import fs from 'fs'
import path from 'path'

/**
 * p48: マイクが止まっているときに、無言で灰色にしない。
 * 両親は「壊れた」と判断してしまうため、入力欄に理由と操作を出す。
 */
const src = fs.readFileSync(
  path.join(process.cwd(), 'src/components/messageInput.tsx'),
  'utf8'
)
const ja = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'locales/ja/translation.json'),
    'utf8'
  )
)

describe('マイク停止中の案内', () => {
  it('常時マイクONで停止中は案内の文言を使う', () => {
    expect(src).toContain("t('MicStoppedTapToRestart')")
  })

  it('案内は「聞き取り中」より後ろの分岐にある（通常時を壊さない）', () => {
    const listening = src.indexOf("t('ListeningContinuously')")
    const hint = src.indexOf("t('MicStoppedTapToRestart')")
    expect(listening).toBeGreaterThan(-1)
    expect(hint).toBeGreaterThan(listening)
  })

  it('日本語の文言が、操作を明示している', () => {
    expect(ja.MicStoppedTapToRestart).toContain('マイクのマーク')
    expect(ja.MicStoppedTapToRestart).toContain('再開')
  })
})
