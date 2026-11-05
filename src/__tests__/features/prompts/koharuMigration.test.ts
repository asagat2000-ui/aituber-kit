import { runSettingsMigrations } from '@/features/stores/settings'
import {
  KOHARU_IDLE_PROMPT,
  KOHARU_SYSTEM_PROMPT,
} from '@/features/prompts/koharu'

describe('こはる仕様への移行（v8 → v9）', () => {
  const run = (state: Record<string, unknown>) =>
    runSettingsMigrations(state as never, 8) as Record<string, unknown>

  it('空の人格プロンプトを v3 で埋める', () => {
    expect(run({ systemPrompt: '' }).systemPrompt).toBe(KOHARU_SYSTEM_PROMPT)
  })

  it('旧プリセット1の人格を v3 に置き換える', () => {
    const old =
      'あなたはこれからuserと仲の良い1人の人間として振舞い会話を行います。'
    expect(run({ systemPrompt: old }).systemPrompt).toBe(KOHARU_SYSTEM_PROMPT)
  })

  it('利用者が書いた人格は残す', () => {
    expect(run({ systemPrompt: 'うちの子の設定です' }).systemPrompt).toBe(
      'うちの子の設定です'
    )
  })

  it('古い独り言プロンプト（昔の話題入り）を差し替える', () => {
    const old = '話題: 昔の遊び、昔の道具、写真、アルバム'
    expect(run({ idleAiPromptTemplate: old }).idleAiPromptTemplate).toBe(
      KOHARU_IDLE_PROMPT
    )
    expect(run({ idleAiPromptTemplate: '' }).idleAiPromptTemplate).toBe(
      KOHARU_IDLE_PROMPT
    )
  })

  it('3文・推論ONを、2文・推論OFFへ移す', () => {
    const result = run({ maxReplySentences: 3, reasoningMode: true })
    expect(result.maxReplySentences).toBe(2)
    expect(result.reasoningMode).toBe(false)
  })

  it('2文・推論OFFのままなら変えない', () => {
    const result = run({ maxReplySentences: 2, reasoningMode: false })
    expect(result.maxReplySentences).toBe(2)
    expect(result.reasoningMode).toBe(false)
  })
})
