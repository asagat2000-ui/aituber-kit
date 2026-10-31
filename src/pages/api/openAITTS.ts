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
 *                       GOOGLE_TTS_KEY という名前でも読み込む（既存 env との互換）
 *   HYBRID_MIN_CHARS    N>0 のとき N 文字未満は Chirp3 HD（無料枠）へ
 */
export const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions'
const CHIRP_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash-lite-tts'
const LANGUAGE_CODE = 'ja-JP'

/** 429 / 5xx のときの再試行回数と待ち時間 */
const MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 900
const MAX_RETRY_DELAY_MS = 5000
/** 同じ台詞の再合成を避けるキャッシュ（LRU 相当） */
const CACHE_LIMIT = 300
const audioCache = new Map<string, Buffer>()

function cacheGet(key: string): Buffer | undefined {
  const hit = audioCache.get(key)
  if (!hit) return undefined
  audioCache.delete(key)
  audioCache.set(key, hit)
  return hit
}

function cacheSet(key: string, value: Buffer): void {
  audioCache.set(key, value)
  while (audioCache.size > CACHE_LIMIT) {
    const oldest = audioCache.keys().next().value
    if (oldest === undefined) break
    audioCache.delete(oldest)
  }
}

/** Chirp3 HD のキー。GOOGLE_TTS_KEY という既存名でも動くようにする */
export function getChirpKey(): string {
  return (
    process.env.GOOGLE_TTS_API_KEY ||
    process.env.GOOGLE_TTS_KEY ||
    ''
  ).trim()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 429 応答から Google 推奨の待ち時間（retryDelay / RetryInfo）を取り出す。
 * 取れなければ null。値は "3s" / "1.5s" / 3000(ms) のような形で来る。
 */
function parseRetryDelayMs(errorText: string): number | null {
  const quoted = errorText.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/)
  if (quoted) return Math.round(Number(quoted[1]) * 1000)
  const bare = errorText.match(/retryDelay"?\s*[:=]\s*"?([0-9.]+)s/)
  if (bare) return Math.round(Number(bare[1]) * 1000)
  return null
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 503 || status === 504
}

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

export function resolveVoices(voice: string): {
  gemini: string
  chirp: string
} {
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

export function resolveStyle(emotion: string | undefined): string {
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

export async function synthesizeWithGemini(
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

  let lastStatus = 0
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    })

    if (response.ok) {
      const payload = (await response.json()) as GeminiResponse
      const base64 = extractGeminiAudio(payload)
      if (!base64) throw new Error('Gemini TTS returned no audio data')
      return Buffer.from(base64, 'base64')
    }

    lastStatus = response.status
    const errorText = await response.text()
    // レート制限（429）は致命ではないので warn に留める
    const logFn = isRetryableStatus(response.status)
      ? logger.warn
      : logger.error
    logFn.call(logger, 'Gemini TTS upstream error:', {
      status: response.status,
      attempt,
      body: errorText.slice(0, 300),
      model,
      voice,
    })

    if (!isRetryableStatus(response.status) || attempt === MAX_RETRIES) {
      throw new Error(
        `Gemini TTS upstream error: ${response.status} ${errorText.slice(0, 240)}`
      )
    }

    // 429 は Google が指定する待ち時間を優先する（体感 1〜2 秒で回復する）
    const suggested =
      response.status === 429 ? parseRetryDelayMs(errorText) : null
    const wait =
      suggested ??
      Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS)
    logger.log(`Gemini TTS retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`)
    await sleep(wait)
  }
  throw new Error(`Gemini TTS upstream error: ${lastStatus}`)
}

export async function synthesizeWithChirp(
  text: string,
  voice: string
): Promise<Buffer> {
  const apiKey = getChirpKey()
  if (!apiKey) {
    throw new Error('GOOGLE_TTS_API_KEY / GOOGLE_TTS_KEY is not set')
  }

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
    throw new Error(
      `Chirp TTS upstream error: ${response.status} ${errorText.slice(0, 240)}`
    )
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

  // 切り分け用: POST /api/openAITTS?probe=1 で両エンジンの素の応答を返す
  if (req.query.probe === '1') {
    const probe: Record<string, unknown> = {
      model: (process.env.GEMINI_TTS_MODEL || DEFAULT_GEMINI_MODEL).trim(),
      keys: {
        gemini: Boolean((process.env.GEMINI_TTS_API_KEY || '').trim()),
        chirp: Boolean(getChirpKey()),
      },
    }
    try {
      await synthesizeWithGemini('動作確認です。', voices.gemini, style)
      probe.gemini = { ok: true }
    } catch (error) {
      probe.gemini = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    try {
      await synthesizeWithChirp('動作確認です。', voices.chirp)
      probe.chirp = { ok: true }
    } catch (error) {
      probe.chirp = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return res.status(200).json(probe)
  }
  const hybridMinChars = Number(process.env.HYBRID_MIN_CHARS || 0)
  const hasChirpKey = !!process.env.GOOGLE_TTS_API_KEY?.trim()
  const requestedModel = (model || '').toString().toLowerCase()

  // 明示的に chirp が選ばれた場合を除き、既定は Gemini
  const preferChirp =
    requestedModel.startsWith('chirp') ||
    (hybridMinChars > 0 && hasChirpKey && message.length < hybridMinChars)

  const cacheKey = `${preferChirp ? 'chirp' : 'gemini'}|${voices.gemini}|${style}|${message}`
  const cached = cacheGet(cacheKey)

  // どのエンジンが応答したかをヘッダで返す（DevTools の Network で確認できる）
  let engine = preferChirp ? 'chirp' : 'gemini'
  let fallbackReason: string | null = null

  let audio: Buffer
  if (cached) {
    audio = cached
    engine = 'cache'
  } else {
    try {
      audio = preferChirp
        ? await synthesizeWithChirp(message, voices.chirp)
        : await synthesizeWithGemini(message, voices.gemini, style)
    } catch (error) {
      const message1 = error instanceof Error ? error.message : String(error)
      engine = preferChirp ? 'gemini' : 'chirp'
      fallbackReason = message1.slice(0, 200)
      logger.warn('TTS failed, trying the other engine:', message1)
      try {
        audio = preferChirp
          ? await synthesizeWithGemini(message, voices.gemini, style)
          : await synthesizeWithChirp(message, voices.chirp)
      } catch (fallbackError) {
        const message2 =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        logger.error('Both TTS engines failed:', { message1, message2 })
        return res.status(500).json({
          error: 'Failed to generate speech',
          errorCode: 'TTSError',
          // 原因の切り分け用（秘密情報は含まない）
          detail: `${message1} / ${message2}`,
          hint: getChirpKey()
            ? undefined
            : 'GOOGLE_TTS_API_KEY が未設定のためフォールバックが使えません',
        })
      }
    }
    cacheSet(cacheKey, audio)
  }

  res.setHeader('X-TTS-Engine', engine)
  if (fallbackReason) {
    res.setHeader('X-TTS-Fallback', encodeURIComponent(fallbackReason))
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
