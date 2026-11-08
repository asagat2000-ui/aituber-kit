import fs from 'fs'
import path from 'path'

/**
 * p47: 設定画面の説明文が実装と一致していること。
 *
 * p44 で「無音で常時マイクを自動OFFにする」処理を撤去したのに、
 * 説明文には「自動的にOFFになる」と残っていた。
 * テストの認識が食い違う原因になるため、文言も検査する。
 */
const ja = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'locales/ja/translation.json'),
    'utf8'
  )
)

describe('常時マイク入力の説明文', () => {
  it('自動でOFFになる、と書いていない', () => {
    expect(ja.ContinuousMicInfo).not.toContain('常時マイク入力はOFF')
  })

  it('自動ではOFFにならないと明記している', () => {
    expect(ja.ContinuousMicInfo).toContain('OFFになることはありません')
  })

  it('無音後の自動送信には触れている（動作は残っている）', () => {
    expect(ja.ContinuousMicInfo).toContain('自動的に送信')
  })
})
