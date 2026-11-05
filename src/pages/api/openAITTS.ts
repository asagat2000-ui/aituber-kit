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
 *   TTS_PRIMARY         'gemini'（既定）| 'chirp' | 'auto'
 *                       gemini 指定時、上限(429)に当たったら Chirp3 HD へ自動切替
 */
export const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions'
const CHIRP_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'
/** デプロイ確認用。診断ページに出るので、反映されたかが一目で分かる */
export const KIT_PATCH_VERSION = 'p34'

/** 実際に送るモデル名。環境変数も定数も参照しない直値。ここが唯一の正 */
const SENT_MODEL = 'gemini-3.8-flash-lite-tts'

/** Gemini TTS の上位モデル（1日100回） */
export const GEMINI_FLASH_TTS = 'gemini-3.8-flash-tts'
/** Gemini TTS の軽量モデル（1日100回）。上限に当たったときの受け皿でもある */
export const GEMINI_FLASH_LITE_TTS = 'gemini-3.8-flash-lite-tts'

/**
 * 使うモデルの順番。
 *  - Flash を選んだ場合: Flash → Flash Lite（→ さらに Chirp3 HD へ）
 *  - Lite を選んだ場合:  Lite（→ Chirp3 HD へ）
 * どちらも 1日100回で尽きるので、尽きたら次の受け皿に送る。
 */
export function buildGeminiModelChain(requested: string): string[] {
  const name = (requested || '').toLowerCase()
  if (name.includes('flash-lite')) return [GEMINI_FLASH_LITE_TTS]
  if (name.includes('flash')) return [GEMINI_FLASH_TTS, GEMINI_FLASH_LITE_TTS]
  return [GEMINI_FLASH_LITE_TTS]
}

/** どのモデルで鳴ったかをヘッダで返すための短い名前 */
export function geminiEngineLabel(model: string): string {
  return model === GEMINI_FLASH_TTS ? 'gemini-flash' : 'gemini'
}

/** 未知の名前は軽量モデルに寄せる（上限の厳しい旧世代を避ける） */
export function normalizeGeminiModel(model: string): string {
  const name = (model || '').toLowerCase()
  if (name.includes('flash-lite')) return GEMINI_FLASH_LITE_TTS
  if (name.includes('flash')) return GEMINI_FLASH_TTS
  return GEMINI_FLASH_LITE_TTS
}

/** 1日の上限に当たったことを表すエラー。次の受け皿へ進む合図に使う */
export class GeminiQuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeminiQuotaError'
  }
}

/** 使うモデルの唯一の正。他の定数や環境変数に引きずられないよう直値で持つ */
export const PREFERRED_GEMINI_TTS_MODEL = SENT_MODEL
export const DEFAULT_GEMINI_MODEL = SENT_MODEL

/** 既定のプライマリ。gemini 優先で、上限に当たったら自動で Chirp に切り替える */
const DEFAULT_PRIMARY = 'gemini'

/** 実際に本文へ入れるモデル名を返す（診断ページ用） */
export function getSentModel(): string {
  return SENT_MODEL
}
const LANGUAGE_CODE = 'ja-JP'

/** 429 / 5xx のときの再試行回数と待ち時間 */
const MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 900
const MAX_RETRY_DELAY_MS = 5000

/**
 * 1日の上限に当たったら、しばらく Gemini を試さずに即フォールバックする。
 * サーバーレスのインスタンスが再利用される間だけ効く、ベストエフォートの仕組み。
 */
const DAILY_QUOTA_COOLDOWN_MS = 10 * 60 * 1000
/** 回復時刻が読めないときに待つ上限。これ以上は待たない */
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000
/** モデルごとのクールダウン期限。Flash が尽きても Lite は使える */
const cooldownUntilByModel: Record<string, number> = {}

/** そのモデルのクールダウン残り(ms)。0 なら使用可 */
export function getModelCooldownRemainingMs(model: string): number {
  return Math.max(0, (cooldownUntilByModel[model] || 0) - Date.now())
}

/** 診断ページ用: 既定モデルのクールダウン残り(ms) */
export function getGeminiCooldownRemainingMs(): number {
  return getModelCooldownRemainingMs(SENT_MODEL)
}

/** 診断ページ用: 実際に使われるプライマリ（env 優先） */
export function getPrimaryEngine(): string {
  const fromEnv = (process.env.TTS_PRIMARY || '').trim().toLowerCase()
  return fromEnv || DEFAULT_PRIMARY
}

/** テスト用: クールダウンを解除する */
export function resetGeminiCooldown(): void {
  Object.keys(cooldownUntilByModel).forEach((key) => {
    delete cooldownUntilByModel[key]
  })
}

/** 旧世代（1.x / 2.x / 3.0〜3.7）は 1日100回などの厳しい上限を持つので使わない */
const LEGACY_MODEL_PATTERN = /gemini-(1\.|2\.|3\.[0-7])/

/**
 * 実際に使うモデル名を決める。
 * 環境変数に旧世代の名前が入っていても、既定の 3.8 に読み替える。
 */
export function resolveModel(): { model: string; ignored: string | null } {
  const fromEnv = (process.env.GEMINI_TTS_MODEL || '').trim()
  if (!fromEnv) return { model: PREFERRED_GEMINI_TTS_MODEL, ignored: null }
  if (LEGACY_MODEL_PATTERN.test(fromEnv.toLowerCase())) {
    return { model: PREFERRED_GEMINI_TTS_MODEL, ignored: fromEnv }
  }
  // 3.8 系以外（将来の未知の名前も含む）は、上限の厳しい旧世代の可能性があるため既定に寄せる
  if (!/^gemini-3\.(8|[9]|\d{2,})/.test(fromEnv.toLowerCase())) {
    return { model: PREFERRED_GEMINI_TTS_MODEL, ignored: fromEnv }
  }
  return { model: fromEnv, ignored: null }
}

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

/**
 * 429 の本文にある「retry in 11h21m38s」形式から待ち時間を取り出す。
 * 日次上限ではこの形式で回復時刻が返るので、その時刻まで Gemini を試さない。
 */
function parseRetryInMs(errorText: string): number | null {
  const m = errorText.match(
    /retry in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*([0-9.]+)s/i
  )
  if (!m) return null
  const hours = Number(m[1] || 0)
  const minutes = Number(m[2] || 0)
  const seconds = Number(m[3] || 0)
  const total = (hours * 3600 + minutes * 60 + seconds) * 1000
  return total > 0 ? Math.round(total) : null
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

/**
 * 待っても回復しない類の 429 かどうか。
 * 「1日あたり100回」のような上限は、その場で待つだけ無駄になる。
 */
function isDailyQuota(errorText: string, retryDelayMs: number | null): boolean {
  if (/per day|perday|daily|FreeTier/i.test(errorText)) return true
  if (retryDelayMs !== null && retryDelayMs > 60000) return true
  return false
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
  style: string,
  requestedModel?: string
): Promise<Buffer> {
  const apiKey = (process.env.GEMINI_TTS_API_KEY || '').trim()
  if (!apiKey) throw new Error('GEMINI_TTS_API_KEY is not set')
  // 選ばれたモデルをそのまま使う（未指定なら従来どおり既定モデル）
  const model = requestedModel
    ? normalizeGeminiModel(requestedModel)
    : SENT_MODEL
  if (getModelCooldownRemainingMs(model) > 0) {
    throw new GeminiQuotaError(
      `Gemini TTS (${model}) is cooling down after a quota error`
    )
  }
  const resolved = resolveModel()
  const ignored = resolved.ignored
  if (ignored) {
    logger.warn('GEMINI_TTS_MODEL is outdated; using the default instead', {
      ignored,
      used: model,
    })
  }

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

    // 429 は Google が指定する待ち時間を優先する
    const suggested =
      response.status === 429 ? parseRetryDelayMs(errorText) : null

    // 1日の上限なら待っても回復しない。無音を長引かせず即フォールバックする。
    if (response.status === 429 && isDailyQuota(errorText, suggested)) {
      const recoverIn = parseRetryInMs(errorText) ?? suggested
      const cooldown =
        recoverIn && recoverIn > 0
          ? Math.min(recoverIn + 1000, MAX_COOLDOWN_MS)
          : DAILY_QUOTA_COOLDOWN_MS
      cooldownUntilByModel[model] = Date.now() + cooldown
      logger.warn('Gemini TTS: daily quota reached for this model', {
        model,
        cooldownSec: Math.round(cooldown / 1000),
      })
      throw new GeminiQuotaError(
        `Gemini TTS daily quota exceeded (${model}): ${errorText.slice(0, 200)}`
      )
    }

    // 429 は長く待たない。1回だけ再試行し、それでも駄目なら Chirp に回す
    if (response.status === 429 && attempt >= 1) {
      throw new Error(`Gemini TTS rate limited: ${errorText.slice(0, 240)}`)
    }

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
  // 以前は GOOGLE_TTS_API_KEY しか見ておらず、GOOGLE_TTS_KEY 運用時に
  // 「Chirpのキーが無い」と誤判定していた。getChirpKey() に統一する。
  const hasChirpKey = !!getChirpKey()
  const requestedModel = (model || '').toString().toLowerCase()

  // 既定は Chirp 3 HD。
  // Gemini TTS は Tier 1 でも 1日100リクエストの上限があり、
  // 1返答で5〜7回呼ぶこのアプリでは1日15往復ほどで尽きてしまうため。
  const primary = getPrimaryEngine()

  let preferChirp: boolean
  if (requestedModel.startsWith('gemini')) {
    preferChirp = false
  } else if (requestedModel.startsWith('chirp')) {
    preferChirp = true
  } else if (primary === 'gemini') {
    preferChirp = false
  } else if (primary === 'auto') {
    // 旧来のハイブリッド動作（短い文だけ Chirp）
    preferChirp =
      hasChirpKey && (hybridMinChars === 0 || message.length < hybridMinChars)
  } else {
    preferChirp = hasChirpKey
  }

  const cacheKey = `${preferChirp ? 'chirp' : `gemini:${requestedModel}`}|${voices.gemini}|${style}|${message}`
  const cached = cacheGet(cacheKey)

  // どのエンジンが応答したかをヘッダで返す（DevTools の Network で確認できる）
  let engine = preferChirp ? 'chirp' : 'gemini'
  let fallbackReason: string | null = null

  let audio: Buffer
  if (cached) {
    audio = cached
    engine = 'cache'
  } else {
    // Flash を選んでいれば Flash → Flash Lite、Lite なら Lite のみ。
    // どのモデルも 1日100回で尽きるので、尽きたら次の受け皿へ送る。
    const chain = buildGeminiModelChain(requestedModel)
    const errors: string[] = []

    const runGemini = async (): Promise<Buffer | null> => {
      for (const target of chain) {
        try {
          const buf = await synthesizeWithGemini(
            message,
            voices.gemini,
            style,
            target
          )
          engine = geminiEngineLabel(target)
          return buf
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          errors.push(reason)
          logger.warn('Gemini TTS failed; trying the next model:', {
            target,
            reason: reason.slice(0, 200),
          })
        }
      }
      return null
    }

    const runChirp = async (): Promise<Buffer | null> => {
      try {
        const buf = await synthesizeWithChirp(message, voices.chirp)
        engine = 'chirp'
        return buf
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        errors.push(reason)
        logger.warn('Chirp TTS failed:', reason.slice(0, 200))
        return null
      }
    }

    let result = preferChirp ? await runChirp() : await runGemini()
    if (!result) {
      result = preferChirp ? await runGemini() : await runChirp()
    }
    if (!result) {
      logger.error('Both TTS engines failed:', errors)
      return res.status(500).json({
        error: 'Failed to generate speech',
        errorCode: 'TTSError',
        // 原因の切り分け用（秘密情報は含まない）
        detail: errors.join(' / ').slice(0, 400),
        hint: getChirpKey()
          ? undefined
          : 'GOOGLE_TTS_API_KEY が未設定のためフォールバックが使えません',
      })
    }
    audio = result
    if (errors.length > 0) fallbackReason = errors[0].slice(0, 200)
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
