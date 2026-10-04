import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConvexCallError } from '../../src/runtime/errors'
import { ServerConvexValidationError } from '../../src/runtime/server/utils/server-convex-options'
import { exchangeConvexToken as exchangeRequestToken } from '../../src/runtime/server/utils/token-exchange'

// ---------------------------------------------------------------------------
// Loopback HTTP harness. We drive the real request-bound exchange through
// global fetch against a real node:http server on 127.0.0.1.
// ---------------------------------------------------------------------------

interface RecordedRequest {
  method: string | undefined
  url: string | undefined
  cookie: string | undefined
  authorization: string | undefined
  clientIp: string | undefined
  clientIpSignature: string | undefined
}

interface Harness {
  siteUrl: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void

const openHarnesses: Harness[] = []
async function harness(handler: Handler): Promise<Harness> {
  const requests: RecordedRequest[] = []
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      cookie: req.headers['cookie'],
      authorization: req.headers['authorization'],
      clientIp:
        typeof req.headers['x-bcn-client-ip'] === 'string'
          ? req.headers['x-bcn-client-ip']
          : undefined,
      clientIpSignature:
        typeof req.headers['x-bcn-client-ip-signature'] === 'string'
          ? req.headers['x-bcn-client-ip-signature']
          : undefined,
    })
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const created = {
    siteUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
  openHarnesses.push(created)
  return created
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  while (openHarnesses.length) {
    const created = openHarnesses.pop()
    if (created) await created.close()
  }
})

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const COOKIE =
  'private_app_cookie=DO_NOT_FORWARD; better-auth.session_token=SUPERSECRET_SESSION_abc123'
const FORWARDED_COOKIE = 'better-auth.session_token=SUPERSECRET_SESSION_abc123'
const PROXY_IP_SECRET = 'token-exchange-proxy-secret-with-32-bytes'

function exchangeConvexToken(
  input: Omit<Parameters<typeof exchangeRequestToken>[0], 'event' | 'trustedClientIpHeader'>,
) {
  vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', PROXY_IP_SECRET)
  return exchangeRequestToken({
    ...input,
    event: { headers: new Headers({ 'cf-connecting-ip': '203.0.113.20' }) } as never,
    trustedClientIpHeader: 'cf-connecting-ip',
  })
}

describe('exchangeConvexToken — success', () => {
  it('exchanges a cookie credential and returns the token (GET /api/auth/convex/token)', async () => {
    const server = await harness((_req, res) => jsonResponse(res, 200, { token: 'jwt.cookie.ok' }))

    const result = await exchangeConvexToken({
      siteUrl: server.siteUrl,
      credential: { type: 'cookie', value: COOKIE },
    })

    expect(result).toEqual({ token: 'jwt.cookie.ok', status: 200, error: null })
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]!.method).toBe('GET')
    expect(server.requests[0]!.url).toBe('/api/auth/convex/token')
    expect(server.requests[0]!.cookie).toBe(FORWARDED_COOKIE)
    expect(server.requests[0]!.authorization).toBeUndefined()
    expect(server.requests[0]!.clientIp).toBe('203.0.113.20')
    expect(server.requests[0]!.clientIpSignature).toMatch(/^[\w-]{43}$/u)
  })
})

describe('exchangeConvexToken — HTTP failure classification', () => {
  it('cancels a non-ok response body before returning the HTTP outcome', async () => {
    const cancel = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new ReadableStream({ start() {}, cancel }), { status: 401 }),
    )

    const result = await exchangeConvexToken({
      siteUrl: 'https://demo.convex.site',
      credential: { type: 'cookie', value: COOKIE },
    })

    expect(result).toMatchObject({ token: null, status: 401 })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([401, 403])('classifies HTTP %s as authentication', async (status) => {
    const server = await harness((_req, res) => jsonResponse(res, status, { error: 'nope' }))

    const result = await exchangeConvexToken({
      siteUrl: server.siteUrl,
      credential: { type: 'cookie', value: COOKIE },
    })

    expect(result.token).toBeNull()
    expect(result.status).toBe(status)
    expect(result.error).toBeInstanceOf(ConvexCallError)
    expect(result.error!.kind).toBe('authentication')
    expect(result.error!.status).toBe(status)
  })

  it.each([
    [
      'HTTP 500',
      (res: http.ServerResponse) => jsonResponse(res, 500, { error: 'boom' }),
      { status: 500, error: { kind: 'transport', code: 'UPSTREAM_ERROR' } },
    ],
    [
      'a missing token (200, no token field)',
      (res: http.ServerResponse) => jsonResponse(res, 200, { notAToken: true }),
      {
        status: 200,
        error: {
          kind: 'transport',
          code: 'INVALID_RESPONSE',
          message: expect.stringMatching(/did not include a token/),
        },
      },
    ],
    [
      'malformed JSON',
      (res: http.ServerResponse) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{ this is not json ]')
      },
      { status: undefined, error: { kind: 'transport' } },
    ],
    [
      'an oversized response (~4 MiB, over the 1 MiB bound)',
      (res: http.ServerResponse) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"token":"' + 'A'.repeat(4 * 1_048_576) + '"}')
      },
      { error: { kind: 'transport' } },
    ],
    [
      'a timeout',
      // Never respond within the 50 ms timeout window below.
      (res: http.ServerResponse) =>
        setTimeout(() => jsonResponse(res, 200, { token: 'late' }), 1_000),
      { status: undefined, error: { kind: 'transport' } },
      50,
    ],
  ])('classifies %s as transport', async (_case, respond, expected, timeoutMs?: number) => {
    const server = await harness((_req, res) => respond(res))

    const result = await exchangeConvexToken({
      siteUrl: server.siteUrl,
      credential: { type: 'cookie', value: COOKIE },
      timeoutMs,
    })

    expect(result).toMatchObject({ token: null, ...expected })
  })

  it('classifies a fetch failure (connection refused) as transport', async () => {
    // A closed loopback port is a transport failure.
    const result = await exchangeConvexToken({
      siteUrl: 'http://127.0.0.1:1',
      credential: { type: 'cookie', value: COOKIE },
    })

    expect(result.token).toBeNull()
    expect(result.status).toBeUndefined()
    expect(result.error!.kind).toBe('transport')
  })
})

describe('exchangeConvexToken — redirect safety (zero credential delivery)', () => {
  it.each([301, 302, 307, 308])(
    'never delivers the credential to a cross-origin %s redirect target',
    async (status) => {
      const recorder = await harness((_req, res) => res.end('recorder'))

      const upstream = await harness((_req, res) => {
        res.writeHead(status, { Location: `${recorder.siteUrl}/recorder` })
        res.end('redirecting')
      })

      const result = await exchangeConvexToken({
        siteUrl: upstream.siteUrl,
        credential: { type: 'cookie', value: COOKIE },
      })

      // Exchange did not throw; it returned a transport error.
      expect(result.token).toBeNull()
      expect(result.error!.kind).toBe('transport')
      // The legit first hop happened exactly once.
      expect(upstream.requests).toHaveLength(1)
      // The redirect target received ZERO requests — the credential never left
      // the first origin.
      expect(recorder.requests).toHaveLength(0)
    },
  )

  it('never delivers the credential to a same-origin redirect target', async () => {
    let sawCredentialOnRecorder = false
    const server = await harness((req, res) => {
      const path = (req.url ?? '').split('?')[0]
      if (path === '/api/auth/convex/token') {
        // Redirect to a same-origin recorder path.
        res.writeHead(302, { Location: `/recorder` })
        res.end('redirecting')
        return
      }
      if (path === '/recorder') {
        if (req.headers['cookie'] || req.headers['authorization']) sawCredentialOnRecorder = true
        res.end('recorder')
        return
      }
      res.writeHead(404).end('nf')
    })

    const result = await exchangeConvexToken({
      siteUrl: server.siteUrl,
      credential: { type: 'cookie', value: COOKIE },
    })

    expect(result.error!.kind).toBe('transport')
    // Only the token endpoint was hit; the /recorder path never received the
    // credential (redirect:'error' rejects before following).
    expect(sawCredentialOnRecorder).toBe(false)
    expect(server.requests.filter((r) => (r.url ?? '').startsWith('/recorder'))).toHaveLength(0)
  })
})

describe('exchangeConvexToken — synchronous credential validation (before network)', () => {
  const cookie = (value: string) => ({ type: 'cookie', value })
  // @ts-expect-error bearer credentials are deliberately absent from the public type
  const _bearer: Parameters<typeof exchangeRequestToken>[0]['credential'] = { type: 'bearer' }
  void _bearer
  const control = (...codes: number[]) => `session=abc${String.fromCharCode(...codes)}def`

  it.each([
    [
      'a CRLF',
      cookie(`session=abc${String.fromCharCode(13, 10)}Host: evil.example`),
      ServerConvexValidationError,
    ],
    ['a bare-LF', cookie(control(10)), ServerConvexValidationError],
    ['a bare-CR', cookie(control(13)), ServerConvexValidationError],
    ['a NUL', cookie(control(0)), ServerConvexValidationError],
    ['a DEL', cookie(control(127)), ServerConvexValidationError],
    ['a TAB', cookie(control(9)), ServerConvexValidationError],
    ['an empty', cookie(''), ServerConvexValidationError],
    // Direct JavaScript callers still require runtime validation.
    ['a basic', { type: 'basic', value: 'credential' }, 'credential must be a cookie credential'],
    // Bearer credentials are deliberately absent from the public type.
    [
      'a bearer',
      { type: 'bearer', value: 'session-token' },
      'credential must be a cookie credential',
    ],
    [
      'an unsupported-cookie',
      cookie('private_app_cookie=DO_NOT_FORWARD'),
      'credential must contain a non-empty supported Better Auth session cookie',
    ],
  ] as const)(
    'rejects %s credential before any network access',
    async (_case, credential, error) => {
      const server = await harness((_req, res) => jsonResponse(res, 200, { token: 'nope' }))

      expect(() =>
        exchangeConvexToken({ siteUrl: server.siteUrl, credential: credential as never }),
      ).toThrow(error)

      // The token endpoint was never contacted.
      expect(server.requests).toHaveLength(0)
    },
  )
})

describe('exchangeConvexToken — secrets never appear in logs', () => {
  it('does not leak the credential through console at any level on failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    const server = await harness((_req, res) => jsonResponse(res, 500, { error: 'boom' }))

    const result = await exchangeConvexToken({
      siteUrl: server.siteUrl,
      credential: { type: 'cookie', value: COOKIE },
    })
    // Also force the error through a console channel to confirm the redacted
    // inspect shape holds even when someone logs it directly.
    console.error(result.error)

    const captured = spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      .join('\n')

    expect(captured).not.toContain('SUPERSECRET_SESSION_abc123')
  })
})
