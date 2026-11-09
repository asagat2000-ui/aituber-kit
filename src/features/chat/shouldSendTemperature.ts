/**
 * temperature（温度）をAPIへ送るかどうかを判定する。
 *
 * Gemini 3.6 以降は temperature を受け取っても無視する。
 * 送っても効かないうえ、値が違うことで「設定が効いていない」と
 * 誤解する原因になるため、Gemini 系には送らない。
 */
export const shouldSendTemperature = (params: {
  selectAIService: unknown
  selectAIModel?: unknown
  customModel?: unknown
}): boolean => {
  const { selectAIService, selectAIModel, customModel } = params
  if (selectAIService === 'google') return false
  return ![selectAIModel, customModel].some(
    (m) => typeof m === 'string' && /gemini/i.test(m)
  )
}
