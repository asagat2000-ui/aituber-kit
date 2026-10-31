import { logger } from '@/lib/logger'
import { NextApiRequest, NextApiResponse } from 'next'
import { withAccessPolicy } from '@/lib/accessPolicy/withAccessPolicy'
import { routePolicies } from '@/lib/accessPolicy/routePolicies'

/**
 * Google の TTS（Gemini TTS / Chirp3 HD）を OpenAI TTS 互換で提供するルート。
 * AITuberKit の「OpenAI TTS」スロットをそのまま使える。
 *
 * 環境変数
 *   GEMINI_TTS_API_KEY  Gemini TTS 用キー（必須）
 *   GEMINI_TTS_MODEL    既定 gemini-3.8-flash-lite-tts
 *   GEMINI_TTS_STYLE    演技指示の既定値
 *   GOOGLE_TTS_API_KEY  Chirp3 HD 用キー（任意 / ハイブリッド・フォールバック用）
 *   HYBRID_MIN_CHARS    N>0 のとき N 文字未満は Chirp3 HD（無料枠）へ
 */
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions'
const CHIRP_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash-lite-tts'
const LANGUAGE_CODE = 'ja-JP'

/** Kit の voice 名 → [Gemini の声, Chirp3 HD の声] */
const VOICE_MAP: Record<string, [string, string]> = {
  alloy: ['Zephyr', 'Aoede'],
  echo: ['Charon', 'Charon'],
  fable: ['Leda', 'Leda'],
  onyx: ['Orus', 'Orus'],
  nova: ['Kore', 'Kore'],
  shimmer: ['Aoede', 'Zephyr'],
  ash: ['Achird', 'Achird'],
  ballad: ['Puck', 'Puck'],
  coral: ['Autonoe', 'Autonoe'],
  sage: ['Schedar', 'Schedar'],
  verse: ['Algenib', 'Algenib'],
}

/** Kit から渡される感情 → 演技指示 */
const EMOTION_STYLE: Record<string, string> = {
  neutral: '落ち着いた自然な口調で',
  joy: '明るく嬉しそうに、感情を込めて',
  happy: '明るく嬉しそうに、感情を込めて',
  fun: '楽しそうに、弾んだ声で',
  angry: '怒っているように、強めの口調で',
  sad: '悲しげに、少し沈んだ声で',
  sorrow: '悲しげに、少し沈んだ声で',
  surprised: '驚いたように、声を高めて',
  calm: '穏やかに、ゆっくりと',
}

interface GeminiAudioPart {
  type?: string
  data?: string
}

interface GeminiStep {
  type?: string
  content?: GeminiAudioPart[]
}

interface GeminiResponse {
  steps?: GeminiStep[]
  output_audio?: { data?: string }
}

function resolveVoices(voice: string): { gemini: string; chirp: string } {
  const name = (voice || '').trim()
  const mapped = VOICE_MAP[name.toLowerCase()]
  if (mapped) return { gemini: mapped[0], chirp: mapped[1] }
  if (name.startsWith(`${LANGUAGE_CODE}-`) && name.includes('-HD-')) {
    const short = name.split('-HD-').pop() || 'Zephyr'
    return { gemini: short, chirp: short }
  }
  const fallback = name || 'Zephyr'
  return { gemini: fallback, chirp: fallback }
}

function resolveStyle(emotion: string | undefined): string {
  const fromEnv = process.env.GEMINI_TTS_STYLE?.trim()
  if (fromEnv) return fromEnv
  const key = (emotion || 'neutral').toLowerCase()
  return EMOTION_STYLE[key] || '自然で感情豊かな話し方で'
}

function extractGeminiAudio(payload: GeminiResponse): string | null {
  const steps = Array.isArray(payload.steps) ? [...payload.steps].reverse() : []
  for (const step of steps) {
    if (step?.type !== 'model_output') continue
    for (const part of step.content || []) {
      if (part?.type === 'audio' && typeof part.data === 'string') {
        return part.data
      }
    }
  }
  const direct = payload.output_audio?.data
  return typeof direct === 'string' ? direct : null
}

/** WAV のチャンクを走査して data 部分（PCM16）だけを取り出す */
function wavToPcm(buffer: Buffer): Buffer {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    return buffer
  }
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    if (chunkId === 'data') {
      const start = offset + 8
      const end = Math.min(start + chunkSize, buffer.length)
      return buffer.subarray(start, end)
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  return buffer
}

async function synthesizeWithGemini(
  text: string,
  voice: string,
  style: string
): Promise<Buffer> {
  const apiKey = (process.env.GEMINI_TTS_API_KEY || '').trim()
  if (!apiKey) throw new Error('GEMINI_TTS_API_KEY is not set')
  const model = (process.env.GEMINI_TTS_MODEL || DEFAULT_GEMINI_MODEL).trim()

  const body = {
    model,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text,
            annotations: [{ type: 'speech_metadata', style }],
          },
        ],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  }

  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Gemini TTS upstream error:', {
      status: response.status,
      body: errorText.slice(0, 500),
      model,
      voice,
    })
    throw new Error(`Gemini TTS upstream error: ${response.status}`)
  }

  const payload = (await response.json()) as GeminiResponse
  const base64 = extractGeminiAudio(payload)
  if (!base64) throw new Error('Gemini TTS returned no audio data')
  return Buffer.from(base64, 'base64')
}

async function synthesizeWithChirp(
  text: string,
  voice: string
): Promise<Buffer> {
  const apiKey = (process.env.GOOGLE_TTS_API_KEY || '').trim()
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY is not set')

  const body = {
    input: { text },
    voice: {
      languageCode: LANGUAGE_CODE,
      name: `${LANGUAGE_CODE}-Chirp3-HD-${voice}`,
    },
    audioConfig: { audioEncoding: 'LINEAR16' },
  }

  const response = await fetch(
    `${CHIRP_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Chirp TTS upstream error:', {
      status: response.status,
      body: errorText.slice(0, 500),
      voice,
    })
    throw new Error(`Chirp TTS upstream error: ${response.status}`)
  }

  const payload = (await response.json()) as { audioContent?: string }
  if (!payload.audioContent) throw new Error('Chirp TTS returned no audio data')
  return Buffer.from(payload.audioContent, 'base64')
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { message, voice, model, emotion } = req.body
  const stream = req.query.stream === 'true'

  if (!message || !voice) {
    return res.status(400).json({ error: 'Missing required parameters' })
  }

  const voices = resolveVoices(voice)
  const style = resolveStyle(emotion)
  const hybridMinChars = Number(process.env.HYBRID_MIN_CHARS || 0)
  const hasChirpKey = !!process.env.GOOGLE_TTS_API_KEY?.trim()
  const requestedModel = (model || '').toString().toLowerCase()

  // 明示的に chirp が選ばれた場合を除き、既定は Gemini
  const preferChirp =
    requestedModel.startsWith('chirp') ||
    (hybridMinChars > 0 && hasChirpKey && message.length < hybridMinChars)

  let audio: Buffer
  try {
    audio = preferChirp
      ? await synthesizeWithChirp(message, voices.chirp)
      : await synthesizeWithGemini(message, voices.gemini, style)
  } catch (error) {
    logger.error('TTS failed, trying the other engine:', error)
    try {
      audio = preferChirp
        ? await synthesizeWithGemini(message, voices.gemini, style)
        : await synthesizeWithChirp(message, voices.chirp)
    } catch (fallbackError) {
      logger.error('Both TTS engines failed:', fallbackError)
      return res.status(500).json({
        error: 'Failed to generate speech',
        errorCode: 'TTSError',
      })
    }
  }

  if (stream) {
    // Kit のストリーミング経路は 24kHz / 16bit / モノラルの生 PCM を期待する
    const pcm = wavToPcm(audio)
    res.writeHead(200, {
      'Content-Type': 'audio/pcm',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Audio-Sample-Rate': '24000',
    })
    res.flushHeaders?.()
    const chunkSize = 8192
    for (let i = 0; i < pcm.length; i += chunkSize) {
      res.write(pcm.subarray(i, i + chunkSize))
    }
    res.end()
    return
  }

  res.setHeader('Content-Type', 'audio/wav')
  res.setHeader('Cache-Control', 'no-store')
  res.send(audio)
}

export default withAccessPolicy(routePolicies['/api/openAITTS'], handler)
