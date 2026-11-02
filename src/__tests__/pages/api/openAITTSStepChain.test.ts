/**
 * @jest-environment node
 */

import {
  buildGeminiModelChain,
  normalizeGeminiModel,
  geminiEngineLabel,
  GEMINI_FLASH_TTS,
  GEMINI_FLASH_LITE_TTS,
} from '@/pages/api/openAITTS'

describe('Gemini TTS の段階フォールバック', () => {
  it('Flash を選ぶと Flash → Flash Lite の順になる', () => {
    expect(buildGeminiModelChain('gemini-3.8-flash-tts')).toEqual([
      GEMINI_FLASH_TTS,
      GEMINI_FLASH_LITE_TTS,
    ])
  })

  it('Flash Lite を選ぶと Lite だけになる（従来どおり）', () => {
    expect(buildGeminiModelChain('gemini-3.8-flash-lite-tts')).toEqual([
      GEMINI_FLASH_LITE_TTS,
    ])
  })

  it('未知の名前は Lite に寄せる', () => {
    expect(buildGeminiModelChain('chirp3-hd')).toEqual([GEMINI_FLASH_LITE_TTS])
    expect(normalizeGeminiModel('')).toBe(GEMINI_FLASH_LITE_TTS)
    expect(normalizeGeminiModel('gemini-2.5-flash-tts')).toBe(GEMINI_FLASH_TTS)
  })

  it('どちらのモデルも、次は Chirp3 HD に落ちる（チェーンの終端）', () => {
    expect(buildGeminiModelChain('gemini-3.8-flash-tts')).not.toContain('chirp')
    expect(buildGeminiModelChain('gemini-3.8-flash-tts').length).toBe(2)
  })

  it('ヘッダ用の名前がモデルごとに分かれる', () => {
    expect(geminiEngineLabel(GEMINI_FLASH_TTS)).toBe('gemini-flash')
    expect(geminiEngineLabel(GEMINI_FLASH_LITE_TTS)).toBe('gemini')
  })
})
