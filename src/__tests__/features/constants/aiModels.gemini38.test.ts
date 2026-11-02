import {
  getReasoningEfforts,
  isReasoningModel,
  isSearchGroundingModel,
} from '@/features/constants/aiModels'

/**
 * Gemini 3.8 Flash は公式に thinking level (LOW/MEDIUM/HIGH) と
 * Grounding with Google Search に対応している。
 * 定義に漏れていると設定画面で「このモデルは非対応」と出て ON にできない。
 */
describe('Gemini 3.8 Flash の設定画面サポート', () => {
  it('推論トグルが有効になる', () => {
    expect(isReasoningModel('google', 'gemini-3.8-flash')).toBe(true)
  })

  it('thinking level は low / medium / high の3段階（minimal 非対応）', () => {
    expect(getReasoningEfforts('google', 'gemini-3.8-flash')).toEqual([
      'low',
      'medium',
      'high',
    ])
  })

  it('検索グラウンディングのトグルが有効になる', () => {
    expect(isSearchGroundingModel('google', 'gemini-3.8-flash')).toBe(true)
  })

  it('3.8 flash-lite は未検証のため据え置き（推論の選択肢なし）', () => {
    expect(getReasoningEfforts('google', 'gemini-3.8-flash-lite')).toEqual([])
  })
})
