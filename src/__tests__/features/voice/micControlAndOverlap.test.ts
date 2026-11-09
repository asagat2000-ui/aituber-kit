import fs from 'fs'
import path from 'path'

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe('マイク操作と発話の重なり（p50）', () => {
  const input = read('components/messageInput.tsx')

  it('常時マイク中はマイクボタンが無効化されていない', () => {
    expect(input).not.toMatch(/disabled=\{\s*continuousMicListeningMode/)
  })

  it('常時マイク中の押下はOFFへ切り替える', () => {
    expect(input).toContain('onToggleContinuousMode(event)')
  })

  it('停止の案内は発話中・生成中には出さない', () => {
    const hint = input.indexOf("t('MicStoppedTapToRestart')")
    const before = input.slice(Math.max(0, hint - 200), hint)
    expect(before).toContain('!isSpeaking')
    expect(before).toContain('!chatProcessing')
  })

  it('送信時に前の発話を止めている', () => {
    const container = read('components/messageInputContainer.tsx')
    const idx = container.indexOf('SpeakQueue.stopAll()')
    expect(idx).toBeGreaterThan(-1)
    expect(container.indexOf('handleSendMessage()', idx)).toBeGreaterThan(idx)
  })
})
