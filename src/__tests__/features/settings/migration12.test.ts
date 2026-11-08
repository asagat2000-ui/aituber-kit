import {
  CURRENT_SETTINGS_VERSION,
  runSettingsMigrations,
} from '@/features/stores/settings'

/**
 * p43: p39 で動いていた状態（常時マイクON・呼びかけ無し）へ戻す移行。
 * 呼びかけ待ちは決め言葉以外を捨てるため、普通に話しかけると無反応になる。
 */
describe('移行ステップ12', () => {
  const base = {
    systemPrompt: 'x',
    idleAiPromptTemplate: 'y',
    maxReplySentences: 2,
    reasoningMode: false,
  } as never

  it('バージョン11以前から来たら、呼びかけOFF・常時マイクONになる', () => {
    const out = runSettingsMigrations(base, 11)
    expect(out.wakeWordEnabled).toBe(false)
    expect(out.continuousMicListeningMode).toBe(true)
  })

  it('古いバージョンから一気に来ても同じ結果になる', () => {
    const out = runSettingsMigrations(base, 3)
    expect(out.wakeWordEnabled).toBe(false)
    expect(out.continuousMicListeningMode).toBe(true)
  })

  it('最新版の番号が12になっている', () => {
    expect(CURRENT_SETTINGS_VERSION).toBe(12)
  })

  it('11でONにした呼びかけを、12が必ず打ち消す', () => {
    const out = runSettingsMigrations(base, 10)
    expect(out.wakeWordEnabled).toBe(false)
  })
})
