import {
  KOHARU_IDLE_PROMPT,
  KOHARU_SYSTEM_PROMPT,
  KOHARU_TAP_HINT,
} from '@/features/prompts/koharu'
import settingsStore from '@/features/stores/settings'

describe('こはるの人格プロンプト', () => {
  it('会話プロンプトが仕様の核を持つ', () => {
    expect(KOHARU_SYSTEM_PROMPT).toContain('10歳の女の子')
    expect(KOHARU_SYSTEM_PROMPT).toContain('2文まで')
    expect(KOHARU_SYSTEM_PROMPT).toContain('また聞いてくれたんだね')
  })

  it('独り言プロンプトに19系統の話題が入っている', () => {
    expect(KOHARU_IDLE_PROMPT).toContain('窓の外に見えているもの')
    expect(KOHARU_IDLE_PROMPT).toContain('19 着ているもの・季節の支度')
    expect(KOHARU_IDLE_PROMPT).not.toContain('昔の遊び')
  })

  it('タップ案内は1行', () => {
    expect(KOHARU_TAP_HINT).toBe('画面を軽く触ってください')
  })

  it('設定の初期値がこのプロンプトを使う', () => {
    const state = settingsStore.getState()
    expect(state.systemPrompt).toBe(KOHARU_SYSTEM_PROMPT)
    expect(state.idleAiPromptTemplate).toBe(KOHARU_IDLE_PROMPT)
    expect(state.maxReplySentences).toBe(2)
  })
})
