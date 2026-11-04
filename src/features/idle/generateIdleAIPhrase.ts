import { logger } from '@/lib/logger'
import { getAIChatResponseStream } from '@/features/chat/aiChatFactory'
import { THINKING_MARKER } from '@/features/chat/vercelAIChat'
import { Message, EmotionType, EMOTIONS } from '@/features/messages/messages'

/* =========================================================================
 * このファイルは「単体で完結」するように作っています。
 * 新規ファイル（idleWeather.ts / idleTopicMemory.ts）を追加する必要はありません。
 *  - 天気取得（Open-Meteo・APIキー不要）
 *  - 当日の話題メモリ（localStorage・日付キー）
 *  - 発話生成
 * をすべてここに入れています。
 * ========================================================================= */

// ---------------------------------------------------------------------------
// 天気（Open-Meteo）
// ---------------------------------------------------------------------------

const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000
const FETCH_TIMEOUT_MS = 4000

/** 既定の地点：埼玉県東松山市（市役所付近）。env で上書き可能 */
const DEFAULT_PLACE = '埼玉県東松山市'
const DEFAULT_LAT = 36.0333
const DEFAULT_LON = 139.4167

export interface WeatherSnapshot {
  place: string
  label: string
  tempNow: number
  tempMax: number
  tempMin: number
  rainProb: number
  summary: string
}

/** WMO 天気コード → 子ども向けのやさしい日本語 */
export function weatherLabel(code: number): string {
  if (code === 0 || code === 1) return 'はれ'
  if (code === 2) return 'はれ時々くもり'
  if (code === 3) return 'くもり'
  if (code === 45 || code === 48) return 'きり'
  if (code >= 51 && code <= 57) return '小雨'
  if (code >= 61 && code <= 67) return 'あめ'
  if (code >= 71 && code <= 77) return 'ゆき'
  if (code === 80 || code === 81 || code === 82) return 'にわか雨'
  if (code === 85 || code === 86) return 'にわか雪'
  if (code >= 95) return 'かみなり'
  return 'くもり'
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function getConfiguredPlace(): string {
  return (process.env.NEXT_PUBLIC_WEATHER_PLACE || '').trim() || DEFAULT_PLACE
}

/**
 * 現在の天気を取得する。取得できなければ null（＝天気には触れない）。
 * 15分キャッシュ。
 */
export async function fetchWeather(
  now: number = Date.now()
): Promise<WeatherSnapshot | null> {
  const place = getConfiguredPlace()

  const cached = readCache<WeatherSnapshot | null>('koharu-weather-snap')
  if (cached && now - cached.at < WEATHER_CACHE_TTL_MS) {
    return cached.value
  }

  const point = await resolveGeo(place)
  if (!point) {
    writeCache('koharu-weather-snap', now, null)
    return null
  }

  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${point.lat}&longitude=${point.lon}` +
    '&current=temperature_2m,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=Asia%2FTokyo&forecast_days=1'

  const json = (await fetchJson(url)) as {
    current?: { temperature_2m?: number; weather_code?: number }
    daily?: {
      temperature_2m_max?: number[]
      temperature_2m_min?: number[]
      precipitation_probability_max?: (number | null)[]
    }
  } | null

  if (!json?.current || typeof json.current.temperature_2m !== 'number') {
    writeCache('koharu-weather-snap', now, null)
    return null
  }

  const tempNow = Math.round(json.current.temperature_2m)
  const tempMax = Math.round(json.daily?.temperature_2m_max?.[0] ?? tempNow)
  const tempMin = Math.round(json.daily?.temperature_2m_min?.[0] ?? tempNow)
  const rainProb = Math.round(
    json.daily?.precipitation_probability_max?.[0] ?? 0
  )
  const label = weatherLabel(Number(json.current.weather_code ?? 3))

  const value: WeatherSnapshot = {
    place: point.name,
    label,
    tempNow,
    tempMax,
    tempMin,
    rainProb,
    summary:
      `地点: ${point.name} / いま: ${label} ${tempNow}度 / ` +
      `きょう: 最高${tempMax}度・最低${tempMin}度・あめの確率${rainProb}パーセント`,
  }

  writeCache('koharu-weather-snap', now, value)
  return value
}

interface GeoPoint {
  name: string
  lat: number
  lon: number
}

/**
 * 地名検索の候補を作る。
 * 「埼玉県東松山市」→ 埼玉県東松山市 / 東松山市 / 埼玉県東松山 / 東松山
 */
export function buildPlaceCandidates(place: string): string[] {
  const raw = place.trim()
  if (!raw) return []
  const withoutPref = raw.replace(
    /^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/,
    ''
  )
  const stripSuffix = (v: string): string => {
    for (const s of ['市', '町', '村', '区']) {
      if (v.length > 1 && v.endsWith(s)) return v.slice(0, -1)
    }
    return v
  }
  return Array.from(
    new Set(
      [raw, withoutPref, stripSuffix(raw), stripSuffix(withoutPref)].filter(
        (v) => v.length > 0
      )
    )
  )
}

async function resolveGeo(place: string): Promise<GeoPoint | null> {
  // 「36.39,139.06」形式
  const direct = place.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
  )
  if (direct) {
    return { name: 'ここ', lat: Number(direct[1]), lon: Number(direct[2]) }
  }

  // 既定地点は地名検索に収録が無いため座標をそのまま使う
  if (place === DEFAULT_PLACE || place === '東松山市') {
    return { name: '東松山市', lat: DEFAULT_LAT, lon: DEFAULT_LON }
  }

  const geoCache = readCache<GeoPoint>('koharu-weather-geo')
  if (geoCache) return geoCache.value

  for (const candidate of buildPlaceCandidates(place)) {
    const url =
      'https://geocoding-api.open-meteo.com/v1/search' +
      `?name=${encodeURIComponent(candidate)}&count=1&language=ja&format=json`
    const json = (await fetchJson(url)) as {
      results?: { name: string; latitude: number; longitude: number }[]
    } | null
    const hit = json?.results?.[0]
    if (hit) {
      const point: GeoPoint = {
        name: hit.name,
        lat: hit.latitude,
        lon: hit.longitude,
      }
      writeCache('koharu-weather-geo', Date.now(), point)
      return point
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// localStorage ヘルパー
// ---------------------------------------------------------------------------

interface Cached<T> {
  at: number
  value: T
}

function readCache<T>(key: string): Cached<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached<T>
    if (!parsed || typeof parsed.at !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeCache<T>(key: string, at: number, value: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify({ at, value }))
  } catch {
    /* 容量超過などは無視 */
  }
}

// ---------------------------------------------------------------------------
// 当日の話題メモリ（同じ日に同じ話題を出さない）
// ---------------------------------------------------------------------------

const TOPIC_STORE_KEY = 'koharu-idle-topic-memory'
const MAX_TOPIC_ENTRIES = 80

export interface TopicEntry {
  label: string
  text: string
  at: number
}

interface StoredTopics {
  date: string
  entries: TopicEntry[]
}

/** 日本時間の YYYY-MM-DD */
export function todayKey(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(
      now
    )
  } catch {
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
}

/** 比較用にラベルを正規化する */
export function normalizeLabel(label: string): string {
  return label
    .replace(/[\s\u3000]/g, '')
    .replace(/[「」『』【】\[\]（）()・、。,.!！?？:：|｜#＃]/g, '')
    .toLowerCase()
}

function readTopics(): StoredTopics | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(TOPIC_STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredTopics
    if (!parsed || typeof parsed.date !== 'string') return null
    if (!Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

export function loadTodayTopics(now: Date = new Date()): TopicEntry[] {
  const stored = readTopics()
  if (!stored) return []
  if (stored.date !== todayKey(now)) return [] // 日付が変われば捨てる
  return stored.entries.filter(
    (e) => e && typeof e.label === 'string' && typeof e.text === 'string'
  )
}

export function recordTopic(
  label: string,
  text: string,
  now: Date = new Date()
): void {
  if (typeof window === 'undefined') return
  const today = todayKey(now)
  const prev = loadTodayTopics(now) // 前日分はここで除外される
  const next: TopicEntry[] = [
    ...prev,
    {
      label: label.slice(0, 40),
      text: text.slice(0, 120),
      at: now.getTime(),
    },
  ].slice(-MAX_TOPIC_ENTRIES)
  try {
    window.localStorage.setItem(
      TOPIC_STORE_KEY,
      JSON.stringify({ date: today, entries: next })
    )
  } catch {
    /* noop */
  }
}

export function isDuplicateTopic(
  label: string,
  now: Date = new Date()
): boolean {
  const target = normalizeLabel(label)
  if (!target) return false
  return loadTodayTopics(now).some((e) => normalizeLabel(e.label) === target)
}

/** 固定セリフが今日すでに出たか */
export function isPhraseUsed(text: string, now: Date = new Date()): boolean {
  const target = text.replace(/[\s\u3000]/g, '')
  if (!target) return false
  return loadTodayTopics(now).some(
    (e) => e.text.replace(/[\s\u3000]/g, '') === target
  )
}

/** 固定セリフを「使用済み」として記録する */
export function markPhraseUsed(text: string, now: Date = new Date()): void {
  recordTopic('fixed', text, now)
}

/** プロンプトに差し込む「今日の禁止リスト」 */
export function buildForbiddenBrief(now: Date = new Date()): string {
  const entries = loadTodayTopics(now)
  if (entries.length === 0) return ''

  const labels = Array.from(
    new Set(
      entries.map((e) => e.label.trim()).filter((l) => l && l !== 'fixed')
    )
  ).slice(-12)
  const texts = entries
    .filter((e) => e.text)
    .slice(-4)
    .map((e) => `・${e.text}`)

  const lines: string[] = []
  if (labels.length > 0) {
    lines.push(
      `今日すでに話した話題（同じ話題は選ばない）: ${labels.join(' / ')}`
    )
  }
  if (texts.length > 0) {
    lines.push('直近のセリフ（同じ言い回しは使わない）:')
    lines.push(...texts)
  }
  return lines.join('\n')
}

/** テスト・デバッグ用 */
export function clearTopicMemory(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(TOPIC_STORE_KEY)
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// 発話生成
// ---------------------------------------------------------------------------

const IDLE_AI_SYSTEM_PROMPT_SUFFIX = `

感情の種類にはneutral, happy, angry, sad, relaxed, surprisedの6つがあります。
回答は必ず次の2行だけにしてください。

1行目: [{感情}]{セリフ}
2行目: #topic: {話題ラベル}

例:
[happy]ねえねえ、コウタ いま ねてるのかな
#topic: コウタ

・セリフはひとつだけ。説明・前置き・箇条書きは書かない。
・{話題ラベル}は、そのセリフが何の話かを表す2〜8文字の短い言葉。
・同じセリフを2回書かない。`

const MAX_ATTEMPTS = 2

export interface IdlePhraseResult {
  text: string
  emotion: EmotionType
  topic: string
}

/**
 * アイドルモード用のAI自動生成発話を生成する
 *
 * キャラクタープロンプトは使用せず、idleAiPromptTemplate のみを
 * システムプロンプトとして利用する（既存仕様）。
 */
export async function generateIdleAIPhrase(
  promptTemplate: string
): Promise<IdlePhraseResult | null> {
  const forbidden = buildForbiddenBrief()
  const weather = await fetchWeather().catch(() => null)

  const contextBlock = [
    weather
      ? `【きょうの実際の天気】\n${weather.summary}\n天気や気温に触れるときは、必ずこの実況に合わせる。晴れていないのに「いい天気」と言わない。`
      : '【天気】\n天気の情報はない。天気・気温・空模様には触れない。',
    forbidden ? `【今日の禁止】\n${forbidden}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const systemPrompt = [
    promptTemplate,
    contextBlock,
    IDLE_AI_SYSTEM_PROMPT_SUFFIX,
  ]
    .filter(Boolean)
    .join('\n\n')

  let last: IdlePhraseResult | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const retryNote =
      attempt === 1
        ? ''
        : '\n\n【やり直し】直前に選んだ話題は今日すでに出た。別の話題にすること。'

    const messages: Message[] = [
      { role: 'system', content: systemPrompt + retryNote },
      { role: 'user', content: 'セリフを一つ生成してください。' },
    ]

    const result = await requestOnce(messages)
    if (!result) continue

    last = result

    if (result.topic && isDuplicateTopic(result.topic)) {
      logger.log(`アイドル発話: 話題重複のため再生成 (${result.topic})`)
      continue
    }

    recordTopic(result.topic, result.text)
    return result
  }

  // 2回とも重複した場合は、最後の結果をそのまま使う（無音より良い）
  if (last) recordTopic(last.topic, last.text)
  return last
}

async function requestOnce(
  messages: Message[]
): Promise<IdlePhraseResult | null> {
  try {
    const stream = await getAIChatResponseStream(messages)
    if (!stream) return null

    const reader = stream.getReader()
    let fullText = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && !value.startsWith(THINKING_MARKER)) {
          fullText += value
        }
      }
    } finally {
      reader.releaseLock()
    }

    fullText = fullText.trim()
    if (!fullText) return null

    const { body, topic } = splitTopicLine(fullText)
    if (!body) return null

    const parsed = parseEmotionAndText(body)
    return { ...parsed, topic: topic || parsed.text.slice(0, 8) }
  } catch (error) {
    logger.error('アイドルAI発話生成エラー:', error)
    return null
  }
}

/** 出力から「#topic: ...」行を切り離す */
function splitTopicLine(raw: string): { body: string; topic: string } {
  const topicMatch = raw.match(/^[#＃]\s*topic\s*[:：]\s*(.+)$/im)
  const topic = topicMatch?.[1]?.trim() ?? ''
  const body = raw
    .split(/\r?\n/)
    .filter((line) => !/^[#＃]\s*topic\s*[:：]/i.test(line.trim()))
    .join('\n')
    .trim()
  return { body, topic }
}

/**
 * AI応答から感情タグとテキストを解析する
 * 例: "[happy]こんにちは！" → { text: "こんにちは！", emotion: "happy" }
 */
function parseEmotionAndText(rawText: string): {
  text: string
  emotion: EmotionType
} {
  const emotionMatch = rawText.match(/^\s*\[(.*?)\]/)

  if (emotionMatch?.[1]) {
    const emotionStr = emotionMatch[1].toLowerCase()
    const emotion: EmotionType = (EMOTIONS as readonly string[]).includes(
      emotionStr
    )
      ? (emotionStr as EmotionType)
      : 'neutral'
    const text = rawText
      .slice(rawText.indexOf(emotionMatch[0]) + emotionMatch[0].length)
      .replace(/\[.*?\]/g, '')
      .trim()

    return { text: text || rawText.replace(/\[.*?\]/g, '').trim(), emotion }
  }

  return { text: rawText.replace(/\[.*?\]/g, '').trim(), emotion: 'neutral' }
}
