import fs from 'fs'
import path from 'path'

/**
 * p45: 起動直後にマイクを開けない環境（スマートフォンのブラウザ）でも、
 * 一度触れば以後は開き直せることをコードの配線で担保する。
 */
const src = fs.readFileSync(
  path.join(process.cwd(), 'src/hooks/useVoiceRecognition.ts'),
  'utf8'
)

describe('操作を契機にしたマイク開始', () => {
  it('pointerdown / keydown / touchstart を購読している', () => {
    ;['pointerdown', 'keydown', 'touchstart'].forEach((e) => {
      expect(src).toContain(`'${e}'`)
    })
  })

  it('購読を解除している（多重登録しない）', () => {
    expect(src).toContain('removeEventListener')
  })

  it('開始可否の判定を純粋関数に委ねている', () => {
    expect(src).toContain('shouldAutoStartMic(')
  })

  it('判定関数はマイクを動かすコードを持たない', () => {
    const gate = fs.readFileSync(
      path.join(process.cwd(), 'src/features/voice/autoStartGate.ts'),
      'utf8'
    )
    expect(gate).not.toMatch(/getUserMedia|startListening|SpeechRecognition/)
  })
})
