/**
 * アイドル発話の「話題かぶり防止」メモリ
 *
 * 同じ日に同じ話題を出さないため、その日話した話題ラベルとセリフを
 * localStorage に日付キーで保存する。日付が変わると自動的に捨てる。
 *
 * 保存形式:
 *   { "date": "2026-11-04", "entries": [{ label, text, at }] }
 */

const STORAGE_KEY = 'koharu-idle-topic-memory'
const MAX_ENTRIES = 80

export interface TopicEntry {
  /** 話題ラベル（例: 天気, 昔の遊び） */
  label: string
  /** 実際に話したセリフ。同じ言い回しの再使用も防ぐ */
  text: string
  /** 記録時刻 (epoch ms) */
  at: number
}

interface StoredMemory {
  date: string
  entries: TopicEntry[]
}

/** 端末のローカル日付ではなく日本時間の YYYY-MM-DD を返す */
export function todayKey(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
    }).format(now)
  } catch {
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
}

/** 比較用にラベルを正規化する（空白・記号・大小の揺れを吸収） */
export function normalizeLabel(label: string): string {
  return label
    .replace(/[\s\u3000]/g, '')
    .replace(/[「」『』【】\[\]（）()・、。,.!！?？:：|｜#＃]/g, '')
    .toLowerCase()
}

function readRaw(): StoredMemory | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredMemory
    if (!parsed || typeof parsed.date !== 'string') return null
    if (!Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

function writeRaw(memory: StoredMemory): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // 容量超過・プライベートモードなどは黙って諦める（発話自体は継続）
  }
}

/** 今日すでに話した話題（新しい順ではなく発話順） */
export function loadTodayTopics(now: Date = new Date()): TopicEntry[] {
  const memory = readRaw()
  if (!memory) return []
  if (memory.date !== todayKey(now)) return []
  return memory.entries.filter(
    (e) => e && typeof e.label === 'string' && typeof e.text === 'string'
  )
}

/**
 * 話題を1件記録する。日付が変わっていれば前日分は破棄する。
 */
export function recordTopic(
  label: string,
  text: string,
  now: Date = new Date()
): void {
  const today = todayKey(now)
  const memory = readRaw()
  // 日付が変わっていれば前日分は捨てる
  const prev = memory && memory.date === today ? memory.entries : []

  const next: TopicEntry[] = [
    ...prev,
    { label: label.slice(0, 40), text: text.slice(0, 120), at: now.getTime() },
  ].slice(-MAX_ENTRIES)

  writeRaw({ date: today, entries: next })
}

/** 今日すでに使った話題ラベルかどうか */
export function isDuplicateTopic(
  label: string,
  now: Date = new Date()
): boolean {
  const target = normalizeLabel(label)
  if (!target) return false
  return loadTodayTopics(now).some((e) => normalizeLabel(e.label) === target)
}

/** 今日すでに出したセリフと同じかどうか（固定セリフ用） */
export function isPhraseUsed(text: string, now: Date = new Date()): boolean {
  const target = text.replace(/[\s\u3000]/g, '')
  if (!target) return false
  return loadTodayTopics(now).some(
    (e) => e.text.replace(/[\s\u3000]/g, '') === target
  )
}

/** 固定セリフを「使用済み」として記録する（label は固定文字列） */
export function markPhraseUsed(text: string, now: Date = new Date()): void {
  recordTopic('fixed', text, now)
}

/**
 * プロンプトに差し込む「今日の禁止リスト」。
 * 話題ラベルは最大12件、セリフは直近4件だけ渡す（プロンプトを太らせない）。
 */
export function buildForbiddenBrief(now: Date = new Date()): string {
  const entries = loadTodayTopics(now)
  if (entries.length === 0) return ''

  const labels = Array.from(
    new Set(entries.map((e) => e.label.trim()).filter((l) => l && l !== 'fixed'))
  ).slice(-12)
  const texts = entries
    .filter((e) => e.text)
    .slice(-4)
    .map((e) => `・${e.text}`)

  const lines: string[] = []
  if (labels.length > 0) {
    lines.push(`今日すでに話した話題（同じ話題は選ばない）: ${labels.join(' / ')}`)
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
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}
