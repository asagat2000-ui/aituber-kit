import {
  CURRENT_SETTINGS_VERSION,
  runSettingsMigrations,
} from '@/features/stores/settings'

/**
 * p46: 12 を適用済みでも常時マイクを必ずONへ戻す。
 * 12 の直後に無音タイマーが false を保存していたため、
 * 端末は「12 適用済み・常時マイクOFF」で固まっていた。
 */
describe('移行ステップ13', () => {
  const base = {
    systemPrompt: 'x',
    idleAiPromptTemplate: 'y',
    maxReplySentences: 2,
    reasoningMode: false,
  } as never

  it('12 適用済み（常時マイクOFF）の端末でも ON に戻る', () => {
    const stored = {
      ...(base as object),
      continuousMicListeningMode: false,
      wakeWordEnabled: false,
    } as never
    const out = runSettingsMigrations(stored, 12)
    expect(out.continuousMicListeningMode).toBe(true)
  })

  it('古い端末から一気に来ても ON になる', () => {
    const out = runSettingsMigrations(base, 5)
    expect(out.continuousMicListeningMode).toBe(true)
    expect(out.wakeWordEnabled).toBe(false)
  })

  it('最新版は13', () => {
    expect(CURRENT_SETTINGS_VERSION).toBe(13)
  })
})
