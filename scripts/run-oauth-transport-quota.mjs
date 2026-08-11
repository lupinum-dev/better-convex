#!/usr/bin/env node

import { fork } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { startLocalMcpOAuthFixture } from './mcp-local-fixture.mjs'

const REQUEST_TIMEOUT_MS = 30_000
const TRUSTED_FIXTURE_IP_HEADER = 'x-fixture-client-ip'
const workerPath = new URL(import.meta.url)

const profile = (name, path, method, limit, guardStatus) =>
  Object.freeze({ guardStatus, limit, method, name, path, windowSeconds: 60 })

export const OAUTH_TRANSPORT_QUOTA_PROFILES = Object.freeze({
  authorize: profile('authorize', '/api/auth/oauth2/authorize', 'GET', 30, 400),
  revoke: profile('revoke', '/api/auth/oauth2/revoke', 'POST', 30, 401),
  token: profile('token', '/api/auth/oauth2/token', 'POST', 20, 401),
})

export const DISABLED_OAUTH_ROUTE_PROBES = Object.freeze([
  Object.freeze({ method: 'POST', path: '/api/auth/token' }),
  Object.freeze({ method: 'POST', path: '/api/auth/get-access-token' }),
  Object.freeze({ method: 'POST', path: '/api/auth/refresh-token' }),
  Object.freeze({ method: 'GET', path: '/api/auth/.well-known/openid-configuration' }),
  Object.freeze({ method: 'POST', path: '/api/auth/oauth2/register' }),
  Object.freeze({ method: 'POST', path: '/api/auth/oauth2/introspect' }),
  Object.freeze({ method: 'POST', path: '/api/auth/oauth2/userinfo' }),
  Object.freeze({ method: 'POST', path: '/api/auth/oauth2/end-session' }),
])

const PRIMARY_IPS = Object.freeze({
  authorize: '198.51.100.41',
  revoke: '203.0.113.41',
  token: '192.0.2.41',
})

const SECONDARY_IPS = Object.freeze({
  authorize: '198.51.100.42',
  revoke: '203.0.113.42',
  token: '192.0.2.42',
})

const allowedWorkerHeaders = new Set([
  'authorization',
  'content-type',
  'origin',
  TRUSTED_FIXTURE_IP_HEADER,
  'x-bcn-client-ip',
  'x-bcn-client-ip-signature',
])

function assert(condition, code) {
  if (!condition) throw new Error(code)
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      url.username === '' &&
      url.password === '' &&
      ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    )
  } catch {
    return false
  }
}

function profileForName(name) {
  const selected = OAUTH_TRANSPORT_QUOTA_PROFILES[name]
  assert(selected, 'OAUTH_QUOTA_PROFILE_INVALID')
  return selected
}

function profileForRequest(request) {
  let url
  try {
    url = new URL(request.url)
  } catch {
    throw new Error('OAUTH_QUOTA_WORKER_INPUT_INVALID')
  }
  return Object.values(OAUTH_TRANSPORT_QUOTA_PROFILES).find(
    (candidate) => candidate.path === url.pathname && candidate.method === request.method,
  )
}

function fixedBasicAuthorization() {
  return `Basic ${Buffer.from('lookup-must-not-run:invalid', 'utf8').toString('base64')}`
}

/** Build a deliberately rejected request whose rate-limit step must still persist. */
export function buildOAuthQuotaRequest(profileName, baseUrl, publicOrigin, headers = {}) {
  const selected = profileForName(profileName)
  assert(isLoopbackUrl(baseUrl), 'OAUTH_QUOTA_BASE_URL_INVALID')
  assert(isLoopbackUrl(publicOrigin), 'OAUTH_QUOTA_PUBLIC_ORIGIN_INVALID')
  const origin = new URL(publicOrigin).origin
  const url = new URL(selected.path, baseUrl)
  const requestHeaders = { ...headers, origin }

  if (selected.name === 'authorize') {
    const parameters = new URLSearchParams({
      client_id: 'lookup-must-not-run',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      redirect_uri: 'http://127.0.0.1:3334/oauth/callback#fragment-not-allowed',
      resource: `${origin}/mcp`,
      response_type: 'code',
      scope: 'mcp:read',
      state: 'quota-boundary',
    })
    parameters.append('resource', `${origin}/mcp`)
    url.search = parameters.toString()
    return Object.freeze({ headers: Object.freeze(requestHeaders), method: 'GET', url: url.href })
  }

  requestHeaders.authorization = fixedBasicAuthorization()
  requestHeaders['content-type'] = 'application/x-www-form-urlencoded'
  const parameters =
    selected.name === 'token'
      ? new URLSearchParams({
          client_id: 'lookup-must-not-run',
          code: 'not-an-authorization-code',
          code_verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
          grant_type: 'authorization_code',
          redirect_uri: 'http://127.0.0.1:3334/oauth/callback',
          resource: `${origin}/mcp`,
        })
      : new URLSearchParams({
          client_id: 'lookup-must-not-run',
          token: 'not-an-access-token',
          token_type_hint: 'access_token',
        })

  return Object.freeze({
    body: parameters.toString(),
    headers: Object.freeze(requestHeaders),
    method: 'POST',
    url: url.href,
  })
}

/** Validate the complete IPC request before a child process opens a socket. */
export function validateQuotaWorkerRequest(value) {
  assert(isRecord(value), 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
  assert(value.method === 'GET' || value.method === 'POST', 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
  assert(
    typeof value.url === 'string' && isLoopbackUrl(value.url),
    'OAUTH_QUOTA_WORKER_INPUT_INVALID',
  )
  const selected = profileForRequest(value)
  assert(selected, 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
  assert(isRecord(value.headers), 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
  const headers = Object.fromEntries(
    Object.entries(value.headers).map(([name, headerValue]) => [name.toLowerCase(), headerValue]),
  )
  assert(
    Object.keys(headers).every((name) => allowedWorkerHeaders.has(name)),
    'OAUTH_QUOTA_WORKER_INPUT_INVALID',
  )
  assert(
    Object.values(headers).every(
      (headerValue) =>
        typeof headerValue === 'string' && headerValue.length > 0 && headerValue.length <= 2_048,
    ),
    'OAUTH_QUOTA_WORKER_INPUT_INVALID',
  )
  assert(
    typeof headers.origin === 'string' &&
      isLoopbackUrl(headers.origin) &&
      new URL(headers.origin).origin === headers.origin,
    'OAUTH_QUOTA_WORKER_INPUT_INVALID',
  )
  const hasSignedIp = headers['x-bcn-client-ip'] !== undefined
  const hasSignedIpSignature = headers['x-bcn-client-ip-signature'] !== undefined
  assert(hasSignedIp === hasSignedIpSignature, 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
  if (hasSignedIpSignature) {
    assert(
      /^[\w-]{43}$/u.test(headers['x-bcn-client-ip-signature']),
      'OAUTH_QUOTA_WORKER_INPUT_INVALID',
    )
  }

  const url = new URL(value.url)
  if (selected.method === 'GET') {
    assert(value.body === undefined, 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
    assert(headers.authorization === undefined, 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
    assert(url.searchParams.getAll('resource').length === 2, 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
  } else {
    assert(url.search === '', 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
    assert(
      typeof value.body === 'string' && value.body.length > 0 && value.body.length <= 16 * 1024,
      'OAUTH_QUOTA_WORKER_INPUT_INVALID',
    )
    assert(
      headers['content-type'] === 'application/x-www-form-urlencoded' &&
        typeof headers.authorization === 'string' &&
        /^Basic [A-Za-z0-9+/]+={0,2}$/u.test(headers.authorization),
      'OAUTH_QUOTA_WORKER_INPUT_INVALID',
    )
    const parameters = new URLSearchParams(value.body)
    assert(parameters.getAll('client_id').length === 1, 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
  }

  return Object.freeze({
    ...(selected.method === 'POST' ? { body: value.body } : {}),
    headers: Object.freeze(headers),
    method: selected.method,
    url: url.href,
  })
}

function safeWorkerFailureCode(error) {
  if (error instanceof Error && /^OAUTH_QUOTA_[A-Z0-9_]{1,64}$/u.test(error.message)) {
    return error.message
  }
  if (error instanceof Error && error.name === 'AbortError') return 'OAUTH_QUOTA_WORKER_TIMEOUT'
  return 'OAUTH_QUOTA_WORKER_FAILED'
}

export function safeQuotaEvidenceFailureCode(error) {
  if (error instanceof Error && /^OAUTH_QUOTA_[A-Z0-9_]{1,64}$/u.test(error.message)) {
    return error.message
  }
  if (
    error instanceof Error &&
    error.message.startsWith('Timed out waiting for MCP OAuth Convex function deployment')
  ) {
    return 'OAUTH_QUOTA_FIXTURE_DEPLOY_TIMEOUT'
  }
  if (error instanceof Error && error.message.startsWith('Timed out waiting for Nuxt MCP OAuth')) {
    return 'OAUTH_QUOTA_FIXTURE_NUXT_TIMEOUT'
  }
  return 'OAUTH_QUOTA_FIXTURE_FAILED'
}

function safeTransportFailureCode(error, selected) {
  const cause = isRecord(error?.cause) ? error.cause : undefined
  const causeCode =
    typeof cause?.code === 'string' &&
    /^(?:EAGAIN|ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|UND_ERR_[A-Z_]{1,32})$/u.test(cause.code)
      ? cause.code
      : 'FAILED'
  return `OAUTH_QUOTA_WORKER_TRANSPORT_${selected.name.toUpperCase()}_${causeCode}`
}

async function performQuotaRequest(input) {
  const request = validateQuotaWorkerRequest(input)
  const selected = profileForRequest(request)
  assert(selected, 'OAUTH_QUOTA_WORKER_INPUT_INVALID')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    let response
    try {
      response = await fetch(request.url, {
        body: request.body,
        headers: request.headers,
        method: request.method,
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(safeTransportFailureCode(error, selected), { cause: error })
      }
      throw error
    }
    const retryAfterValue = response.headers.get('x-retry-after')
    await response.body?.cancel().catch(() => {})
    return Object.freeze({
      retryAfter:
        retryAfterValue !== null && /^\d{1,3}$/u.test(retryAfterValue)
          ? Number(retryAfterValue)
          : null,
      status: response.status,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function runRequestWorker() {
  assert(typeof process.send === 'function', 'OAUTH_QUOTA_WORKER_IPC_MISSING')
  process.send({ type: 'ready' })
  process.once('message', async (message) => {
    try {
      assert(isRecord(message) && message.type === 'request', 'OAUTH_QUOTA_WORKER_MESSAGE_INVALID')
      const result = await performQuotaRequest(message.request)
      process.send?.({ result, type: 'result' })
    } catch (error) {
      process.send?.({ error: safeWorkerFailureCode(error), type: 'error' })
    } finally {
      process.disconnect()
    }
  })
}

async function stopWorker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 1_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit').catch(() => {})
  }
}

function createQuotaWorker() {
  const child = fork(workerPath, ['--request-worker'], {
    env: {},
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  let pendingRequest
  let readySettled = false
  let resolveReady
  let rejectReady
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise
    rejectReady = rejectPromise
  })
  const readyTimer = setTimeout(() => {
    rejectReady(new Error('OAUTH_QUOTA_WORKER_READY_TIMEOUT'))
    void stopWorker(child)
  }, REQUEST_TIMEOUT_MS)

  const fail = (code) => {
    if (!readySettled) {
      readySettled = true
      clearTimeout(readyTimer)
      rejectReady(new Error(code))
    }
    if (pendingRequest) {
      clearTimeout(pendingRequest.timer)
      pendingRequest.reject(new Error(code))
      pendingRequest = undefined
    }
  }

  child.on('error', (error) => {
    const code =
      typeof error?.code === 'string' && /^(?:EAGAIN|EMFILE|ENFILE|ENOENT)$/u.test(error.code)
        ? error.code
        : 'FAILED'
    fail(`OAUTH_QUOTA_WORKER_SPAWN_${code}`)
  })
  child.on('exit', (code) => {
    if (!readySettled || (code !== 0 && code !== null)) fail('OAUTH_QUOTA_WORKER_EXITED')
    else if (pendingRequest) fail('OAUTH_QUOTA_WORKER_EXITED')
  })
  child.on('message', (message) => {
    if (!isRecord(message)) return
    if (message.type === 'ready' && !readySettled) {
      readySettled = true
      clearTimeout(readyTimer)
      resolveReady()
      return
    }
    if (!pendingRequest || message.type === 'ready') return
    const pending = pendingRequest
    pendingRequest = undefined
    clearTimeout(pending.timer)
    if (
      message.type === 'result' &&
      isRecord(message.result) &&
      Number.isSafeInteger(message.result.status) &&
      message.result.status >= 100 &&
      message.result.status <= 599 &&
      (message.result.retryAfter === null || Number.isSafeInteger(message.result.retryAfter))
    ) {
      pending.resolve(Object.freeze(message.result))
    } else if (
      message.type === 'error' &&
      typeof message.error === 'string' &&
      /^OAUTH_QUOTA_[A-Z0-9_]{1,64}$/u.test(message.error)
    ) {
      pending.reject(new Error(message.error))
    } else {
      pending.reject(new Error('OAUTH_QUOTA_WORKER_RESULT_INVALID'))
    }
  })

  return Object.freeze({
    ready,
    request: async (request) => {
      await ready
      assert(!pendingRequest, 'OAUTH_QUOTA_WORKER_BUSY')
      try {
        return await new Promise((resolvePromise, rejectPromise) => {
          const timer = setTimeout(() => {
            pendingRequest = undefined
            rejectPromise(new Error('OAUTH_QUOTA_WORKER_RESPONSE_TIMEOUT'))
            void stopWorker(child)
          }, REQUEST_TIMEOUT_MS)
          pendingRequest = { reject: rejectPromise, resolve: resolvePromise, timer }
          child.send({ request, type: 'request' }, (error) => {
            if (!error) return
            if (pendingRequest) {
              clearTimeout(pendingRequest.timer)
              pendingRequest = undefined
            }
            rejectPromise(new Error('OAUTH_QUOTA_WORKER_SEND_FAILED'))
          })
        })
      } finally {
        await stopWorker(child)
      }
    },
    stop: () => stopWorker(child),
  })
}

async function runChildProcessBoundary(leftRequest, rightRequest) {
  const workers = [createQuotaWorker(), createQuotaWorker()]
  try {
    await Promise.all(workers.map((worker) => worker.ready))
    return await Promise.all([workers[0].request(leftRequest), workers[1].request(rightRequest)])
  } finally {
    await Promise.all(workers.map((worker) => worker.stop()))
  }
}

function assertGuardRejection(selected, result, code) {
  assert(
    result.status === selected.guardStatus && result.retryAfter === null,
    `${code}_${selected.name.toUpperCase()}_${result.status}_${result.retryAfter ?? 'NONE'}`,
  )
}

function assertThrottled(selected, result, code) {
  assert(
    result.status === 429 &&
      Number.isSafeInteger(result.retryAfter) &&
      result.retryAfter > 0 &&
      result.retryAfter <= selected.windowSeconds,
    code,
  )
}

export function summarizeQuotaBoundary(profileName, results) {
  const selected = profileForName(profileName)
  assert(Array.isArray(results) && results.length >= 2, 'OAUTH_QUOTA_BOUNDARY_INVALID')
  let admitted = 0
  let throttled = 0
  for (const result of results) {
    if (isRecord(result) && result.status === selected.guardStatus && result.retryAfter === null) {
      admitted += 1
    } else if (
      isRecord(result) &&
      result.status === 429 &&
      Number.isSafeInteger(result.retryAfter) &&
      result.retryAfter > 0 &&
      result.retryAfter <= selected.windowSeconds
    ) {
      throttled += 1
    } else {
      throw new Error('OAUTH_QUOTA_BOUNDARY_RESULT_INVALID')
    }
  }
  assert(
    admitted === 1 && throttled === results.length - 1,
    `OAUTH_QUOTA_BOUNDARY_EXCEEDED_${selected.name.toUpperCase()}_${admitted}_${throttled}`,
  )
  return Object.freeze({ admitted, childProcesses: results.length, throttled })
}

async function headersForTransport(fixture, transport, clientIp) {
  if (transport === 'nuxt') return Object.freeze({ [TRUSTED_FIXTURE_IP_HEADER]: clientIp })
  assert(transport === 'direct', 'OAUTH_QUOTA_TRANSPORT_INVALID')
  return fixture.signedClientIpHeadersForTest(clientIp)
}

async function requestForTransport(fixture, selected, transport, clientIp) {
  const headers = await headersForTransport(fixture, transport, clientIp)
  return buildOAuthQuotaRequest(
    selected.name,
    transport === 'nuxt' ? fixture.origin : fixture.convexSiteUrl,
    fixture.origin,
    headers,
  )
}

async function assertDisabledRoutes(fixture) {
  let probes = 0
  for (const baseUrl of [fixture.origin, fixture.convexSiteUrl]) {
    for (const route of DISABLED_OAUTH_ROUTE_PROBES) {
      const headers =
        route.method === 'POST'
          ? { 'content-type': 'application/x-www-form-urlencoded', origin: fixture.origin }
          : {}
      if (baseUrl === fixture.origin) headers[TRUSTED_FIXTURE_IP_HEADER] = '198.51.100.250'
      const response = await fetch(new URL(route.path, baseUrl), {
        body: route.method === 'POST' ? '' : undefined,
        headers,
        method: route.method,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      await response.body?.cancel().catch(() => {})
      assert(response.status === 404, 'OAUTH_QUOTA_DISABLED_ROUTE_EXPOSED')
      probes += 1
    }
  }
  return probes
}

async function assertHardenedCeremonyPages(fixture) {
  let pages = 0
  for (const path of ['/login', '/oauth/consent']) {
    const response = await fetch(new URL(path, fixture.origin), {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    await response.body?.cancel().catch(() => {})
    const cacheControl = response.headers.get('cache-control')?.toLowerCase().split(',') ?? []
    const contentSecurityPolicy = response.headers.get('content-security-policy') ?? ''
    assert(response.status === 200, 'OAUTH_QUOTA_CEREMONY_PAGE_UNAVAILABLE')
    assert(
      cacheControl.map((value) => value.trim()).includes('no-store'),
      'OAUTH_QUOTA_CEREMONY_PAGE_CACHEABLE',
    )
    assert(
      contentSecurityPolicy
        .split(';')
        .map((value) => value.trim().toLowerCase())
        .includes("frame-ancestors 'none'"),
      'OAUTH_QUOTA_CEREMONY_PAGE_FRAMEABLE',
    )
    assert(
      response.headers.get('x-frame-options')?.toUpperCase() === 'DENY' &&
        response.headers.get('referrer-policy')?.toLowerCase() === 'no-referrer',
      'OAUTH_QUOTA_CEREMONY_PAGE_HEADERS_INVALID',
    )
    pages += 1
  }
  return pages
}

async function runProfileQuota(fixture, selected) {
  let admitted = 0
  for (let index = 0; index < selected.limit - 1; index += 1) {
    const transport = index % 2 === 0 ? 'nuxt' : 'direct'
    const request = await requestForTransport(
      fixture,
      selected,
      transport,
      PRIMARY_IPS[selected.name],
    )
    const result = await performQuotaRequest(request)
    assertGuardRejection(selected, result, 'OAUTH_QUOTA_LIMIT_TOO_LOW')
    admitted += 1
  }

  const boundaryRequests = await Promise.all([
    requestForTransport(fixture, selected, 'nuxt', PRIMARY_IPS[selected.name]),
    requestForTransport(fixture, selected, 'direct', PRIMARY_IPS[selected.name]),
  ])
  const boundary = summarizeQuotaBoundary(
    selected.name,
    await runChildProcessBoundary(boundaryRequests[0], boundaryRequests[1]),
  )
  admitted += boundary.admitted
  assert(admitted === selected.limit, 'OAUTH_QUOTA_LIMIT_TOO_HIGH')

  const blockedByTransport = await Promise.all(
    ['nuxt', 'direct'].map(async (transport) => {
      const request = await requestForTransport(
        fixture,
        selected,
        transport,
        PRIMARY_IPS[selected.name],
      )
      return performQuotaRequest(request)
    }),
  )
  blockedByTransport.forEach((result) =>
    assertThrottled(selected, result, 'OAUTH_QUOTA_TRANSPORT_BYPASS'),
  )

  const independent = await Promise.all(
    ['nuxt', 'direct'].map(async (transport) => {
      const request = await requestForTransport(
        fixture,
        selected,
        transport,
        SECONDARY_IPS[selected.name],
      )
      return performQuotaRequest(request)
    }),
  )
  independent.forEach((result) =>
    assertGuardRejection(selected, result, 'OAUTH_QUOTA_SIGNED_IP_NOT_INDEPENDENT'),
  )

  return Object.freeze({
    admitted,
    boundaryChildProcesses: boundary.childProcesses,
    boundaryThrottled: boundary.throttled,
    independentAdmitted: independent.length,
    limit: selected.limit,
    transportBypassBlocked: blockedByTransport.length,
  })
}

async function runIpHeaderBoundary(fixture) {
  const selected = OAUTH_TRANSPORT_QUOTA_PROFILES.token
  const forgedSignature = 'A'.repeat(43)
  const directRejected = await Promise.all(
    [1, 2].map((suffix) =>
      performQuotaRequest(
        buildOAuthQuotaRequest(selected.name, fixture.convexSiteUrl, fixture.origin, {
          'x-bcn-client-ip': `10.88.0.${suffix}`,
          'x-bcn-client-ip-signature': forgedSignature,
        }),
      ),
    ),
  )
  directRejected.forEach((result) =>
    assert(
      result.status === 500 && result.retryAfter === null,
      'OAUTH_QUOTA_FORGED_DIRECT_PAIR_NOT_REJECTED',
    ),
  )

  let nuxtAdmitted = 0
  for (let index = 1; index <= selected.limit; index += 1) {
    const request = buildOAuthQuotaRequest(selected.name, fixture.origin, fixture.origin, {
      [TRUSTED_FIXTURE_IP_HEADER]: '198.51.100.88',
      'x-bcn-client-ip': `10.88.0.${index}`,
      'x-bcn-client-ip-signature': forgedSignature,
    })
    const result = await performQuotaRequest(request)
    assertGuardRejection(selected, result, 'OAUTH_QUOTA_FORGED_PROXY_HEADER_ESCAPE')
    nuxtAdmitted += 1
  }

  const nuxtOverflow = buildOAuthQuotaRequest(selected.name, fixture.origin, fixture.origin, {
    [TRUSTED_FIXTURE_IP_HEADER]: '198.51.100.88',
    'x-bcn-client-ip': '10.88.0.202',
    'x-bcn-client-ip-signature': forgedSignature,
  })
  assertThrottled(
    selected,
    await performQuotaRequest(nuxtOverflow),
    'OAUTH_QUOTA_FORGED_PROXY_HEADER_ESCAPE',
  )

  const signedHeaders = await fixture.signedClientIpHeadersForTest('192.0.2.99')
  const signedRequest = buildOAuthQuotaRequest(
    selected.name,
    fixture.convexSiteUrl,
    fixture.origin,
    signedHeaders,
  )
  assertGuardRejection(
    selected,
    await performQuotaRequest(signedRequest),
    'OAUTH_QUOTA_FORGED_IP_POISONED_SIGNED_BUCKET',
  )
  return Object.freeze({
    directRejected: directRejected.length,
    nuxtAdmitted,
    nuxtThrottled: 1,
    signedIndependent: 1,
  })
}

export async function runOAuthTransportQuotaEvidence() {
  const fixture = await startLocalMcpOAuthFixture({
    trustedClientIpHeaderForTest: TRUSTED_FIXTURE_IP_HEADER,
  })
  try {
    const disabledRouteProbes = await assertDisabledRoutes(fixture)
    const hardenedPages = await assertHardenedCeremonyPages(fixture)
    const profiles = {}
    for (const selected of Object.values(OAUTH_TRANSPORT_QUOTA_PROFILES)) {
      profiles[selected.name] = await runProfileQuota(fixture, selected)
    }
    const ipHeaderBoundary = await runIpHeaderBoundary(fixture)
    return Object.freeze({
      disabledRouteProbes,
      hardenedPages,
      ipHeaderBoundary,
      profiles: Object.freeze(profiles),
    })
  } finally {
    await fixture.release()
  }
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (process.argv[2] === '--request-worker') {
  runRequestWorker().catch((error) => {
    process.send?.({ error: safeWorkerFailureCode(error), type: 'error' })
    process.exitCode = 1
  })
} else if (invokedAsScript) {
  runOAuthTransportQuotaEvidence()
    .then((report) => {
      const quotaCounts = Object.entries(report.profiles)
        .map(([name, result]) => `${name}=${result.admitted}/${result.limit}`)
        .join(',')
      const childProcesses = Object.values(report.profiles).reduce(
        (total, result) => total + result.boundaryChildProcesses,
        0,
      )
      const boundaryThrottled = Object.values(report.profiles).reduce(
        (total, result) => total + result.boundaryThrottled,
        0,
      )
      const bypassesBlocked = Object.values(report.profiles).reduce(
        (total, result) => total + result.transportBypassBlocked,
        0,
      )
      const independentAdmitted = Object.values(report.profiles).reduce(
        (total, result) => total + result.independentAdmitted,
        0,
      )
      console.log(
        `[oauth-transport-quota] PASS: disabled=${report.disabledRouteProbes}; pages=${report.hardenedPages}; quotas=${quotaCounts}; boundary=${childProcesses}/${boundaryThrottled}; independent=${independentAdmitted}; bypasses-blocked=${bypassesBlocked}; ip-headers=${report.ipHeaderBoundary.nuxtAdmitted}/${report.ipHeaderBoundary.nuxtThrottled}/${report.ipHeaderBoundary.directRejected}/${report.ipHeaderBoundary.signedIndependent}.`,
      )
    })
    .catch((error) => {
      console.error(safeQuotaEvidenceFailureCode(error))
      process.exitCode = 1
    })
}
