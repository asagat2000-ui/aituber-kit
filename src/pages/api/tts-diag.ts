import type { NextApiRequest, NextApiResponse } from 'next'
import {
  GEMINI_ENDPOINT,
  DEFAULT_GEMINI_MODEL,
  getChirpKey,
  PREFERRED_GEMINI_TTS_MODEL,
  resolveModel,
  resolveStyle,
  resolveVoices,
  synthesizeWithChirp,
  synthesizeWithGemini,
} from './openAITTS'

type Check = {
  name: string
  ok: boolean
  status: number
  ms: number
  bytes: number
  detail: string
}

const mask = (value: string | undefined) => {
  const v = (value || '').trim()
  if (!v) return '未設定'
  return `設定済み（${v.length}文字 / 末尾 ${v.slice(-4)}）`
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 実際に使われるモデル名を素で叩き、HTTPステータスと本文をそのまま返す */
async function rawCall(model: string, voice: string, style: string) {
  const apiKey = (process.env.GEMINI_TTS_API_KEY || '').trim()
  const started = Date.now()
  if (!apiKey) {
    return {
      status: 0,
      ms: 0,
      errorText: 'GEMINI_TTS_API_KEY が未設定',
      keys: '',
    }
  }
  const body = {
    model,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text: '動作確認です。',
            annotations: [{ type: 'speech_metadata', style }],
          },
        ],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  }
  try {
    const r = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    })
    const ms = Date.now() - started
    if (!r.ok) {
      return {
        status: r.status,
        ms,
        errorText: (await r.text()).slice(0, 600),
        keys: '',
      }
    }
    const json = (await r.json()) as Record<string, unknown>
    const size = JSON.stringify(json).length
    return {
      status: r.status,
      ms,
      errorText: '',
      keys: `レスポンス項目: ${Object.keys(json).join(', ')} / 約${size}文字`,
    }
  } catch (error) {
    return {
      status: -1,
      ms: Date.now() - started,
      errorText: error instanceof Error ? error.message : String(error),
      keys: '',
    }
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const voice = (req.query.voice as string) || 'alloy'
  const burst = req.query.burst === '1'
  const voices = resolveVoices(voice)
  const style = resolveStyle(undefined)
  const envModel = (process.env.GEMINI_TTS_MODEL || '').trim()
  const { model, ignored } = resolveModel()

  const checks: Check[] = []

  // 1) 本番経路そのもの（リトライ込み）
  const startedReal = Date.now()
  try {
    const buf = await synthesizeWithGemini(
      '動作確認です。',
      voices.gemini,
      style
    )
    checks.push({
      name: 'Gemini 実経路（リトライ込み）',
      ok: true,
      status: 200,
      ms: Date.now() - startedReal,
      bytes: buf.length,
      detail: '音声が返りました',
    })
  } catch (error) {
    checks.push({
      name: 'Gemini 実経路（リトライ込み）',
      ok: false,
      status: 0,
      ms: Date.now() - startedReal,
      bytes: 0,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  // 2) 素の1回だけ叩いて理由を見る
  const raw = await rawCall(model, voices.gemini, style)
  checks.push({
    name: `Gemini 素叩き（${model}）`,
    ok: raw.status === 200,
    status: raw.status,
    ms: raw.ms,
    bytes: 0,
    detail: raw.errorText || raw.keys,
  })

  // 3) Chirp
  try {
    const buf = await synthesizeWithChirp('動作確認です。', voices.chirp)
    checks.push({
      name: 'Chirp 3 HD',
      ok: true,
      status: 200,
      ms: 0,
      bytes: buf.length,
      detail: '音声が返りました',
    })
  } catch (error) {
    checks.push({
      name: 'Chirp 3 HD',
      ok: false,
      status: 0,
      ms: 0,
      bytes: 0,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  // 4) 連投テスト（7連発で429が出るか）
  let burstLine = ''
  if (burst) {
    const codes: string[] = []
    for (let i = 0; i < 7; i++) {
      const r = await rawCall(model, voices.gemini, style)
      codes.push(r.status === 200 ? '200' : String(r.status))
    }
    burstLine = codes.join(' / ')
  }

  const geminiOk = checks[0].ok
  const banner = geminiOk
    ? { text: 'Gemini TTS は Vercel から使えます', color: '#0f7b3f' }
    : { text: 'Gemini TTS が Vercel から使えません', color: '#b3261e' }

  const rows = checks
    .map(
      (c) =>
        `<tr><td>${esc(c.name)}</td><td style="color:${
          c.ok ? '#0f7b3f' : '#b3261e'
        }">${c.ok ? 'OK' : 'NG'}</td><td>${c.status || '-'}</td><td>${
          c.ms
        }ms</td><td>${c.bytes || '-'}</td><td style="font-size:12px;word-break:break-all">${esc(
          c.detail
        )}</td></tr>`
    )
    .join('')

  const env = [
    ['GEMINI_TTS_MODEL（env）', envModel || '未設定（既定値を使用）'],
    [
      '実際に使うモデル',
      ignored ? `${model}（env の ${ignored} は旧世代のため無視）` : model,
    ],
    ['GEMINI_TTS_STYLE', process.env.GEMINI_TTS_STYLE || '未設定'],
    ['HYBRID_MIN_CHARS', process.env.HYBRID_MIN_CHARS || '未設定'],
    ['GEMINI_TTS_API_KEY', mask(process.env.GEMINI_TTS_API_KEY)],
    ['GOOGLE_TTS_API_KEY', mask(process.env.GOOGLE_TTS_API_KEY)],
    ['GOOGLE_TTS_KEY', mask(process.env.GOOGLE_TTS_KEY)],
    ['Chirp 解決結果', getChirpKey() ? '取得可' : '取得不可'],
  ]
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('')

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.status(200)
    .send(`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TTS 診断</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;margin:0;padding:16px;background:#fafafa;color:#111;line-height:1.5}
h1{font-size:17px;margin:0 0 12px}
.banner{padding:12px;border-radius:10px;color:#fff;font-weight:700;font-size:15px;margin-bottom:16px;background:${banner.color}}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
th,td{text-align:left;padding:8px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top}
th{background:#f2f2f2;font-size:12px}
a.btn{display:block;text-align:center;padding:14px;background:#111;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;margin-bottom:10px}
.note{font-size:12px;color:#555}
pre{background:#fff;padding:10px;border-radius:8px;font-size:11px;overflow:auto}
</style></head><body>
<h1>TTS 診断（このページをスクショしてください）</h1>
<div class="banner">${esc(banner.text)}</div>
<table><tr><th>テスト</th><th>結果</th><th>HTTP</th><th>時間</th><th>bytes</th><th>詳細</th></tr>${rows}</table>
<table><tr><th>環境変数</th><th>値</th></tr>${env}</table>
${
  burst
    ? `<table><tr><th>連投7回</th><th>${esc(burstLine)}</th></tr></table>`
    : '<a class="btn" href="?burst=1">連投テスト（7回）を実行</a>'
}
<p class="note">末尾4文字が Cloud Shell の <code>~/.gk</code> と同じか確認してください。違えば Vercel のキーが別物です。</p>
</body></html>`)
}

export default handler
