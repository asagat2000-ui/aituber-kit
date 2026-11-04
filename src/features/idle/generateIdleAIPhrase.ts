import { logger } from '@/lib/logger'
import { getAIChatResponseStream } from '@/features/chat/aiChatFactory'
import { THINKING_MARKER } from '@/features/chat/vercelAIChat'
import { Message, EmotionType, EMOTIONS } from '@/features/messages/messages'
import { buildForbiddenBrief, isDuplicateTopic, recordTopic } from './idleTopicMemory'
import { fetchWeather } from './idleWeather'

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

/** 生成結果。topic は「同じ日に同じ話題を出さない」ための判定キー */
export interface IdlePhraseResult {
  text: string
  emotion: EmotionType
  topic: string
}

/**
 * アイドルモード用のAI自動生成発話を生成する
 *
 * キャラクタープロンプトは使用せず、idleAiPromptTemplateのみを
 * システムプロンプトとして利用する。
 *
 * 話題の単調さ対策として以下を行う:
 *  - 今日すでに話した話題ラベル・セリフをプロンプトに渡して禁止する
 *  - 実際の天気（Open-Meteo）をプロンプトに差し込み、天気の話を実況に合わせる
 *  - 生成結果の話題が今日すでに出ていれば、もう一度だけ生成し直す
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

  const systemPrompt = [promptTemplate, contextBlock, IDLE_AI_SYSTEM_PROMPT_SUFFIX]
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
      logger.info(`アイドル発話: 話題重複のため再生成 (${result.topic})`)
      continue
    }

    recordTopic(result.topic, result.text)
    return result
  }

  // 2回とも重複した場合は、最後の結果をそのまま使う（無音より良い）
  if (last) recordTopic(last.topic, last.text)
  return last
}

async function requestOnce(messages: Message[]): Promise<IdlePhraseResult | null> {
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

/**
 * 出力から「#topic: ...」行を切り離す。
 * 話題ラベルが無い場合は topic を空文字で返す（呼び出し側で本文から補う）。
 */
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
      .replace(/\[.*?\]/g, '') // 途中の感情タグも削除
      .trim()

    return { text: text || rawText.replace(/\[.*?\]/g, '').trim(), emotion }
  }

  return { text: rawText.replace(/\[.*?\]/g, '').trim(), emotion: 'neutral' }
}
