import { shouldSendTemperature } from '@/features/chat/shouldSendTemperature'
import fs from 'fs'
import path from 'path'

describe('temperature の送信判定', () => {
  it('Gemini 系のモデルには送らない', () => {
    expect(
      shouldSendTemperature({
        selectAIService: 'custom-api',
        customModel: 'gemini-3.8-flash-lite',
      })
    ).toBe(false)
  })

  it('google サービスには送らない', () => {
    expect(
      shouldSendTemperature({ selectAIService: 'google', selectAIModel: 'x' })
    ).toBe(false)
  })

  it('OpenAI などには送る（切り替えても設定が効く）', () => {
    expect(
      shouldSendTemperature({
        selectAIService: 'openai',
        selectAIModel: 'gpt-4o',
      })
    ).toBe(true)
  })

  it('モデル名が未知でも送る（安全側）', () => {
    expect(shouldSendTemperature({ selectAIService: 'custom-api' })).toBe(true)
  })

  it('チャット経路が判定関数を使っている', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/features/chat/vercelAIChat.ts'),
      'utf8'
    )
    expect(src).toContain('shouldSendTemperature({')
    expect(src).toContain('temperature: rawTemperature')
  })
})
