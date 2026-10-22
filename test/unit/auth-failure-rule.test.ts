import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchConvexToken, type ConvexTokenSource } from '../../src/runtime/auth/token-fetcher'
import { resolveServerAuthSnapshot } from '../../src/runtime/server/utils/auth-snapshot'
import { webServerEvent } from '../helpers/server-event'

const { fetchWithTimeoutMock } = vi.hoisted(() => ({ fetchWithTimeoutMock: vi.fn() }))

vi.mock('../../src/runtime/server/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/runtime/server/utils/http')>()),
  fetchWithTimeout: fetchWithTimeoutMock,
}))

function jwt(claims: Record<string, unknown>) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`
}
const now = () => Math.floor(Date.now() / 1000)

type Answer =
  | { kind: 'no-answer' }
  | { kind: 'timeout' }
  | { kind: 'status'; status: number }
  | { kind: 'token'; token: string | null }

/** The server render's class: a rejection renders anonymous without an error. */
async function serverClass(answer: Answer) {
  fetchWithTimeoutMock.mockImplementation(async () => {
    if (answer.kind === 'no-answer') throw new TypeError('fetch failed')
    if (answer.kind === 'timeout') throw new DOMException('timed out', 'TimeoutError')
    if (answer.kind === 'status') return new Response('{}', { status: answer.status })
    return Response.json({ token: answer.token })
  })
  const snapshot = await resolveServerAuthSnapshot({
    event: webServerEvent(),
    siteUrl: 'https://demo.convex.site',
    publicOrigin: 'https://app.example.test',
    cookieHeader: 'better-auth.session_token=session-1',
    requestId: 'request-1',
    trackWaterfall: false,
    trustedClientIpHeader: '',
  })
  expect(snapshot.token).toBeNull()
  return snapshot.authError?.class ?? 'rejected'
}

async function browserClass(answer: Answer) {
  const source = {
    convex: {
      token: async () => {
        if (answer.kind === 'no-answer') throw new TypeError('Failed to fetch')
        if (answer.kind === 'timeout') return new Promise<never>(() => {})
        if (answer.kind === 'status') return { data: null, error: { status: answer.status } }
        return { data: { token: answer.token }, error: null }
      },
    },
  } satisfies ConvexTokenSource
  const outcome = fetchConvexToken(source)
  await vi.runAllTimersAsync()
  const { identity, failure } = await outcome
  expect(identity).toBeNull()
  return failure?.class
}

// One rule for every auth failure (#281): the server render and the browser
// give the same class for the same answer from the auth backend.
describe('auth failure rule', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each<[string, 'rejected' | 'temporary' | 'setup', () => Answer]>([
    ['no answer', 'temporary', () => ({ kind: 'no-answer' })],
    ['a timeout', 'temporary', () => ({ kind: 'timeout' })],
    ['HTTP 408', 'temporary', () => ({ kind: 'status', status: 408 })],
    ['HTTP 429', 'temporary', () => ({ kind: 'status', status: 429 })],
    ['HTTP 503', 'temporary', () => ({ kind: 'status', status: 503 })],
    ['HTTP 401', 'rejected', () => ({ kind: 'status', status: 401 })],
    ['HTTP 403', 'rejected', () => ({ kind: 'status', status: 403 })],
    ['HTTP 302', 'setup', () => ({ kind: 'status', status: 302 })],
    ['HTTP 404', 'setup', () => ({ kind: 'status', status: 404 })],
    ['HTTP 200 without a token', 'setup', () => ({ kind: 'token', token: null })],
    [
      'a token that lives 30 s',
      'setup',
      () => ({ kind: 'token', token: jwt({ sub: 'alice', iat: now(), exp: now() + 30 }) }),
    ],
    [
      'a token without sub',
      'setup',
      () => ({ kind: 'token', token: jwt({ iat: now(), exp: now() + 900 }) }),
    ],
  ])('%s is %s on the server and in the browser', async (_name, expected, answer) => {
    expect(await serverClass(answer())).toBe(expected)
    expect(await browserClass(answer())).toBe(expected)
  })
})
