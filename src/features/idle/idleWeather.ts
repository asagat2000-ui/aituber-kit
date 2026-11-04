/**
 * アイドル発話用の天気取得（Open-Meteo / APIキー不要）
 *
 * 地点は既定で 埼玉県東松山市。環境変数 NEXT_PUBLIC_WEATHER_PLACE で上書きできる。
 *   例: NEXT_PUBLIC_WEATHER_PLACE=前橋市
 *   例: NEXT_PUBLIC_WEATHER_PLACE=36.39,139.06   （緯度,経度を直接指定）
 *
 * 取得できなければ null を返し、プロンプト側で「天気には触れない」に倒す。
 * 推測で天気を語らせないための設計。
 */

const GEO_CACHE_KEY = 'koharu-weather-geo'
const CACHE_TTL_MS = 15 * 60 * 1000
const FETCH_TIMEOUT_MS = 4000

interface GeoPoint {
  name: string
  latitude: number
  longitude: number
}

/**
 * 既定の地点。
 * Open-Meteo の地名検索は「東松山市」を収録しておらず0件になるため、
 * 緯度経度をここに持たせて検索失敗を避ける（東松山市役所付近）。
 */
const DEFAULT_PLACE = '埼玉県東松山市'
const DEFAULT_POINT: GeoPoint = {
  name: '東松山市',
  latitude: 36.0333,
  longitude: 139.4167,
}

export interface WeatherSnapshot {
  /** 地点名（例: 東松山市） */
  place: string
  /** 子ども向けの天気ことば（はれ / くもり / あめ …） */
  label: string
  /** 現在の気温 */
  tempNow: number
  /** 今日の最高気温 */
  tempMax: number
  /** 今日の最低気温 */
  tempMin: number
  /** 降水確率(%) */
  rainProb: number
  /** プロンプトに差し込む1行サマリ */
  summary: string
}

let memoryCache: { at: number; value: WeatherSnapshot | null } | null = null

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

/** 「36.39,139.06」形式か判定 */
function parseLatLon(place: string): GeoPoint | null {
  const m = place.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (!m) return null
  return { name: 'ここ', latitude: Number(m[1]), longitude: Number(m[2]) }
}

/**
 * 地名検索の候補を作る。
 * 「埼玉県東松山市」→ 埼玉県東松山市 / 東松山市 / 埼玉県東松山 / 東松山
 * 市名フル表記が収録されていない場合でも、接尾辞を落とせば当たることが多い。
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

  const list = [
    raw,
    withoutPref,
    stripSuffix(raw),
    stripSuffix(withoutPref),
  ].map((v) => v.trim())

  return Array.from(new Set(list.filter((v) => v.length > 0)))
}

function readGeoCache(place: string): GeoPoint | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(GEO_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, GeoPoint>
    return parsed[place] ?? null
  } catch {
    return null
  }
}

function writeGeoCache(place: string, point: GeoPoint): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(GEO_CACHE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, GeoPoint>) : {}
    parsed[place] = point
    window.localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(parsed))
  } catch {
    /* noop */
  }
}

async function resolveGeo(place: string): Promise<GeoPoint | null> {
  const direct = parseLatLon(place)
  if (direct) return direct

  // 既定地点は検索に出ないため、座標をそのまま使う
  if (place === DEFAULT_PLACE || place === DEFAULT_POINT.name) {
    return DEFAULT_POINT
  }

  const cached = readGeoCache(place)
  if (cached) return cached

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
        latitude: hit.latitude,
        longitude: hit.longitude,
      }
      writeGeoCache(place, point)
      return point
    }
  }
  return null
}

export function getConfiguredPlace(): string {
  return (process.env.NEXT_PUBLIC_WEATHER_PLACE || '').trim() || DEFAULT_PLACE
}

/**
 * 現在の天気を取得する。取得できなければ null。
 * 15分キャッシュ（アイドル発話のたびにAPIを叩かないため）。
 */
export async function fetchWeather(
  now: number = Date.now()
): Promise<WeatherSnapshot | null> {
  const place = getConfiguredPlace()
  if (!place) return null

  if (memoryCache && now - memoryCache.at < CACHE_TTL_MS) {
    return memoryCache.value
  }

  memoryCache = { at: now, value: null }

  const point = await resolveGeo(place)
  if (!point) return null

  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${point.latitude}&longitude=${point.longitude}` +
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
    return null
  }

  const tempNow = Math.round(json.current.temperature_2m)
  const tempMax = Math.round(json.daily?.temperature_2m_max?.[0] ?? tempNow)
  const tempMin = Math.round(json.daily?.temperature_2m_min?.[0] ?? tempNow)
  const rainProb = Math.round(
    json.daily?.precipitation_probability_max?.[0] ?? 0
  )
  const label = weatherLabel(Number(json.current.weather_code ?? 3))

  const summary =
    `地点: ${point.name} / いま: ${label} ${tempNow}度 / ` +
    `きょう: 最高${tempMax}度・最低${tempMin}度・あめの確率${rainProb}パーセント`

  const value: WeatherSnapshot = {
    place: point.name,
    label,
    tempNow,
    tempMax,
    tempMin,
    rainProb,
    summary,
  }
  memoryCache = { at: now, value }
  return value
}

/** テスト用にキャッシュを捨てる */
export function clearWeatherCache(): void {
  memoryCache = null
}
