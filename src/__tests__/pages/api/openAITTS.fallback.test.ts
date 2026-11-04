/**
 * @jest-environment node
 */

import handler, {
  getGeminiCooldownRemainingMs,
  resetGeminiCooldown,
} from '@/pages/api/openAITTS'

const originalFetch = global.fetch
const originalEnv = { ...process.env }

const dailyQuota = () => ({
  ok: false,
  status: 429,
  text: async () =>
    JSON.stringify({
      error: {
        code: 429,
        message:
          'Rate limit exceeded for model gemini-3.8-flash-lite-tts (limit: 100 requests per day on Tier 1). Please retry in 11h21m38s',
        status: 'RESOURCE_EXHAUSTED',
      },
    }),
})

const chirpOk = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    audioContent: Buffer.from('RIFFxxxx').toString('base64'),
  }),
})

const createReq = (body: Record<string, unknown>) =>
  ({
    method: 'POST',
    body,
    query: {},
    headers: {},
    cookies: {},
  }) as unknown as Parameters<typeof handler>[0]

const createRes = () => {
  const res: Record<string, any> = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
    setHeader(k: string, v: string) {
      res.headers[k.toLowerCase()] = v
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(obj: unknown) {
      res.body = obj
      return res
    },
    send(buf: unknown) {
      res.body = buf
      return res
    },
    writeHead() {
      return res
    },
    write() {
      return true
    },
    end() {
      return res
    },
    flushHeaders() {},
  }
  return res
}

describe('/api/openAITTS Gemini→Chirp 自動切替', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetGeminiCooldown()
    process.env = {
      ...originalEnv,
      GEMINI_TTS_API_KEY: 'test-gemini',
      GOOGLE_TTS_API_KEY: 'test-chirp',
      TTS_PRIMARY: 'gemini',
    }
    global.fetch = jest.fn()
  })

  afterAll(() => {
    global.fetch = originalFetch
    process.env = originalEnv
  })

  it('日次上限(429)に当たったら Chirp3 HD で音声を返す', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(dailyQuota())
      .mockResolvedValueOnce(chirpOk())

    const req = createReq({
      message: '上限テストです。',
      voice: 'alloy',
      model: 'gemini-3.8-flash-lite-tts',
    })
    const res = createRes()

    await handler(req, res as never)

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-tts-engine']).toBe('chirp')
    expect(getGeminiCooldownRemainingMs()).toBeGreaterThan(60000)
  })

  it('クールダウン中は Gemini を叩かず Chirp だけを使う', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(dailyQuota())
      .mockResolvedValueOnce(chirpOk())

    await handler(
      createReq({
        message: '1回目です。',
        voice: 'alloy',
        model: 'gemini-3.8-flash-lite-tts',
      }),
      createRes() as never
    )
    ;(global.fetch as jest.Mock).mockClear()
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(chirpOk())

    const res = createRes()
    await handler(
      createReq({
        message: '2回目です。',
        voice: 'alloy',
        model: 'gemini-3.8-flash-lite-tts',
      }),
      res as never
    )

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(res.headers['x-tts-engine']).toBe('chirp')
  })
})
