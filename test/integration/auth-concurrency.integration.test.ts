// Auth adapter concurrency, rate limits, session admission and JWKS rotation on
// the pinned local backend, driven against an isolated copy of the playground.
import { createHmac, randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BaseConvexClient, ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadBackendManifest } from '../helpers/local-backend.mjs'
import { ensureLocalConvex, type EnsureLocalConvexResult } from '../helpers/local-convex'
import { isRecord, root, sleep, type JsonRecord } from './harness'

type Ref = FunctionReference<'query' | 'mutation' | 'action', 'public'>

/** ConvexHttpClient with the admin-only APIs the typings hide. */
interface AdminClient {
  setAdminAuth(key: string): void
  query(ref: Ref, args: JsonRecord): Promise<unknown>
  mutation(ref: Ref, args: JsonRecord): Promise<unknown>
  action(ref: Ref, args: JsonRecord): Promise<unknown>
  function(ref: Ref, componentPath: string | undefined, args: JsonRecord): Promise<unknown>
}

function convexClient(url: string, adminKey?: string): AdminClient {
  const client = new ConvexHttpClient(url, { logger: false }) as unknown as AdminClient
  if (adminKey) client.setAdminAuth(adminKey)
  return client
}

const ref = (name: string) => makeFunctionReference(name) as unknown as Ref
const race = {
  create: ref('authConcurrency:createRaceRow'),
  createWithFailingTrigger: ref('authConcurrency:createRaceRowWithFailingTrigger'),
  consume: ref('authConcurrency:consumeRaceRow'),
  consumeWithFailingTrigger: ref('authConcurrency:consumeRaceRowWithFailingTrigger'),
  increment: ref('authConcurrency:incrementRaceRow'),
  incrementWithFailingTrigger: ref('authConcurrency:incrementRaceRowWithFailingTrigger'),
  jwksState: ref('authConcurrency:readJwksRaceState'),
  read: ref('authConcurrency:readRaceRow'),
  runtimeCapabilities: ref('authConcurrency:readRuntimeCapabilities'),
  remove: ref('authConcurrency:deleteRaceRow'),
  rotate: ref('authConcurrency:rotateSigningKeyRace'),
  updateManyWithFailingTrigger: ref('authConcurrency:updateRaceRowsWithFailingTrigger'),
}
const adapter = {
  count: ref('adapter:count'),
  create: ref('adapter:create'),
  findOne: ref('adapter:findOne'),
  increment: ref('adapter:incrementOne'),
  remove: ref('adapter:deleteMany'),
  sessionAdmission: ref('adapter:sessionAdmission'),
}
const componentPath = 'betterAuth'
const compoundAccountProvider = 'bcn-compound-race'
// Same value test/helpers/local-convex.ts provisions for the playground deployment.
const proxyIpSecret = 'better-convex-nuxt-e2e-proxy-ip-secret-32-bytes'
const authOrigin = 'http://localhost:3050'
// The WebSocket admission close was reviewed against this backend source commit.
const admissionGuardSourceCommit = '44f7aa7f7ffc35ac56d8fada8e864aecb03f27f8'
const totalRequests = 200
const lanes = 20
const iterations = totalRequests / lanes

/** Stable failure class for a mutation error; raw messages never reach assertions. */
function failureClass(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text.includes('AUTH_LOGICAL_ID_CONFLICT')) return 'AUTH_LOGICAL_ID_CONFLICT'
  if (text.includes('AUTH_UNIQUE_CONFLICT:rateLimit.id')) return 'AUTH_LOGICAL_ID_CONFLICT'
  const unique = /AUTH_UNIQUE_CONFLICT:[\w.]+/u.exec(text)?.[0]
  if (unique) return unique
  if (text.includes('AUTH_TRIGGER_FAULT_INJECTED')) return 'AUTH_TRIGGER_FAULT_INJECTED'
  if (
    /optimistic concurrency(?: control)?|\bocc(?: error)?\b/iu.test(text) ||
    (/documents? read from or written to/iu.test(text) &&
      /changed while this mutation was being run/iu.test(text))
  ) {
    return 'CONVEX_CONTENTION'
  }
  return 'UNEXPECTED_MUTATION_FAILURE'
}

interface RaceResult {
  ok: boolean
  value?: unknown
  error?: string
}

/**
 * `lanes` independent clients, each sending its requests in order, all at once.
 * Only increments retry, and only on a final OCC contention error, which means
 * the mutation did not commit; every committed increment still counts once.
 */
async function runRace(
  url: string,
  adminKey: string,
  laneCount: number,
  perLane: number,
  invoke: (client: AdminClient, lane: number, index: number) => Promise<unknown>,
  retryContention = false,
): Promise<RaceResult[]> {
  const lane = async (laneIndex: number) => {
    const client = convexClient(url, adminKey)
    const results: RaceResult[] = []
    for (let index = 0; index < perLane; index += 1) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          results.push({ ok: true, value: await invoke(client, laneIndex, index) })
          break
        } catch (error) {
          const failure = failureClass(error)
          if (!retryContention || failure !== 'CONVEX_CONTENTION' || attempt >= 5) {
            results.push({ ok: false, error: failure })
            break
          }
          await sleep(
            Math.min(5 * 2 ** attempt, 80) + ((laneIndex * 11 + index * 7 + attempt * 3) % 7),
          )
        }
      }
    }
    return results
  }
  return (await Promise.all(Array.from({ length: laneCount }, (_, index) => lane(index)))).flat()
}

const winners = (results: RaceResult[]) => results.filter((result) => result.ok).length
const failures = (results: RaceResult[]) => [
  ...new Set(results.filter((result) => !result.ok).map((result) => result.error)),
]

function signClientIp(clientIp: string) {
  return createHmac('sha256', proxyIpSecret).update(`v1\n${clientIp}`).digest('base64url')
}

const signInBody = JSON.stringify({
  email: 'rate-limit-missing@example.test',
  password: 'not-a-real-password',
})

function signedSignIn(siteUrl: string, clientIp: string, signature = signClientIp(clientIp)) {
  return fetch(`${siteUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: authOrigin,
      'x-bcn-client-ip': clientIp,
      'x-bcn-client-ip-signature': signature,
    },
    body: signInBody,
  })
}

function directSignIn(siteUrl: string) {
  return fetch(`${siteUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: authOrigin },
    body: signInBody,
  })
}

function getSession(siteUrl: string, clientIp: string) {
  return fetch(`${siteUrl}/api/auth/get-session`, {
    headers: {
      origin: authOrigin,
      'x-bcn-client-ip': clientIp,
      'x-bcn-client-ip-signature': signClientIp(clientIp),
    },
  })
}

function privateJwkMembers(value: unknown, path = '$'): string[] {
  if (Array.isArray(value))
    return value.flatMap((entry, index) => privateJwkMembers(entry, `${path}[${index}]`))
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([name, child]) => [
    ...(['d', 'p', 'q', 'dp', 'dq', 'qi', 'privateKey'].includes(name) ? [`${path}.${name}`] : []),
    ...privateJwkMembers(child, `${path}.${name}`),
  ])
}

const isAdmissionDenied = (message: string) =>
  /component.*(?:admin|auth)|(?:admin|auth).*component|unauthenticated|unauthorized|not authenticated|not authorized|BadDeployKey|provided deploy key was invalid/iu.test(
    message,
  )
const isPublicFunctionMissing = (message: string) =>
  /could not find public function|not a public function/iu.test(message)
const isInconclusiveSocketClose = (message: string) =>
  /closed with code 1011\b.+internal(?:servererror| server error)/iu.test(message)

interface SubscribingClient {
  setAdminAuth(key: string): void
  subscribe(
    name: string,
    args: JsonRecord,
    options: { componentPath?: string },
  ): { queryToken: string; unsubscribe: () => void }
  localQueryResultByToken(token: string): unknown
  close(): Promise<void>
}

/** Subscribe over the WebSocket transport and settle on the first result or server error. */
async function subscribeOnce(
  url: string,
  name: string,
  args: JsonRecord,
  options: { adminKey?: string; componentPath?: string } = {},
): Promise<{ value: unknown } | { error: string }> {
  let client: SubscribingClient | undefined
  let subscription: { queryToken: string; unsubscribe: () => void } | undefined
  let timer: NodeJS.Timeout | undefined
  try {
    return await new Promise((resolve) => {
      const failed = (error: unknown) =>
        resolve({ error: error instanceof Error ? error.message : String(error) })
      client = new BaseConvexClient(
        url,
        (tokens: readonly unknown[]) => {
          if (!subscription || !tokens.includes(subscription.queryToken)) return
          try {
            const value = client!.localQueryResultByToken(subscription.queryToken)
            if (value !== undefined) resolve({ value })
          } catch (error) {
            failed(error)
          }
        },
        { logger: false, onServerDisconnectError: failed },
      ) as unknown as SubscribingClient
      if (options.adminKey) client.setAdminAuth(options.adminKey)
      timer = setTimeout(() => resolve({ error: 'AUTH_ADMISSION_WS_TIMEOUT' }), 15_000)
      subscription = client.subscribe(name, args, { componentPath: options.componentPath })
    })
  } finally {
    clearTimeout(timer)
    subscription?.unsubscribe()
    await client?.close()
  }
}

async function rejection(invoke: () => Promise<unknown>): Promise<string> {
  try {
    await invoke()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return 'UNEXPECTED_SUCCESS'
}

describe('auth adapter on the pinned backend', () => {
  let parent: string
  let local: EnsureLocalConvexResult | undefined
  let url: string
  let siteUrl: string
  let adminKey: string
  let client: AdminClient

  beforeAll(async () => {
    process.env.CONVEX_E2E_AUTO_START = 'true'
    process.env.BCN_E2E_REQUIRE_LOCAL = 'true'
    // An isolated playground copy: its own .convex state, the repository source and packages.
    parent = mkdtempSync(join(tmpdir(), 'bcn-auth-concurrency-'))
    const cwd = join(parent, 'playground')
    const source = join(root, 'playground')
    cpSync(source, cwd, {
      recursive: true,
      filter: (path) =>
        !/^(?:\.env\.local|\.convex|node_modules|\.nuxt|\.output)(?:\/|$)/u.test(
          path.slice(source.length + 1),
        ),
    })
    const modules = join(cwd, 'node_modules')
    mkdirSync(join(modules, '@lupinum'), { recursive: true })
    symlinkSync(join(root, 'src'), join(parent, 'src'), 'dir')
    symlinkSync(join(root, 'node_modules'), join(parent, 'node_modules'), 'dir')
    symlinkSync(join(root, 'node_modules/better-auth'), join(modules, 'better-auth'), 'dir')
    symlinkSync(root, join(modules, '@lupinum/better-convex-nuxt'), 'dir')
    symlinkSync(join(root, 'node_modules/convex'), join(modules, 'convex'), 'dir')

    local = await ensureLocalConvex({ cwd, timeoutMs: 120_000 })
    url = String(local.env.CONVEX_URL)
    siteUrl = String(local.env.CONVEX_SITE_URL)
    const config = JSON.parse(
      readFileSync(join(cwd, '.convex/local/default/config.json'), 'utf8'),
    ) as { adminKey?: string; deploymentName?: string }
    expect(config.adminKey?.startsWith(`${config.deploymentName}|`)).toBe(true)
    adminKey = config.adminKey!
    client = convexClient(url, adminKey)
  })

  afterAll(async () => {
    await local?.release()
    if (parent) rmSync(parent, { recursive: true, force: true })
  })

  it('admits sessions only through the component transport, never publicly', async () => {
    const suffix = randomUUID()
    const args = {
      sessionId: `bcn-boundary-session-${suffix}`,
      userId: `bcn-boundary-user-${suffix}`,
    }
    const canaryToken = `synthetic-not-provider-issued-${suffix}`
    const now = Date.now()
    // A masked WebSocket close is accepted as "inconclusive" only on the reviewed backend.
    expect(
      loadBackendManifest().backendVersion.endsWith(`-${admissionGuardSourceCommit.slice(0, 7)}`),
      'AUTH_ADMISSION_PROTOCOL_SOURCE_REVIEW_REQUIRED',
    ).toBe(true)
    const acceptsCanary = (value: unknown) => {
      const session = isRecord(value) && isRecord(value.session) ? value.session : {}
      const user = isRecord(value) && isRecord(value.user) ? value.user : {}
      return (
        session.id === args.sessionId &&
        session.userId === args.userId &&
        session.token === canaryToken &&
        user.id === args.userId
      )
    }
    try {
      await client.function(adapter.create, componentPath, {
        model: 'user',
        data: {
          id: args.userId,
          name: 'Synthetic boundary user',
          email: `${suffix}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      })
      await client.function(adapter.create, componentPath, {
        model: 'session',
        data: {
          id: args.sessionId,
          userId: args.userId,
          token: canaryToken,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 300_000,
        },
      })
      const readCanary = async () =>
        acceptsCanary(await client.function(adapter.sessionAdmission, componentPath, args))
      expect(await readCanary(), 'AUTH_ADMISSION_COMPONENT_CONTROL_FAILED').toBe(true)

      const anonymous = convexClient(url)
      const http = await rejection(() =>
        anonymous.function(adapter.sessionAdmission, componentPath, args),
      )
      expect(isAdmissionDenied(http), `AUTH_ADMISSION_HTTP_COMPONENT_BOUNDARY: ${http}`).toBe(true)
      const publicQuery = await rejection(() => anonymous.query(adapter.sessionAdmission, args))
      expect(isPublicFunctionMissing(publicQuery), 'AUTH_ADMISSION_ROOT_PUBLIC_BOUNDARY').toBe(true)

      const adminSocket = await subscribeOnce(url, 'adapter:sessionAdmission', args, {
        adminKey,
        componentPath,
      })
      expect(
        'value' in adminSocket && acceptsCanary(adminSocket.value),
        'AUTH_ADMISSION_WS_CONTROL_FAILED',
      ).toBe(true)
      const rootControl = async () => {
        const result = await subscribeOnce(url, 'auth:getPermissionContext', {})
        return 'value' in result && result.value === null
      }
      expect(await rootControl(), 'AUTH_ADMISSION_WS_ROOT_BEFORE').toBe(true)
      const socket = await subscribeOnce(url, 'adapter:sessionAdmission', args, { componentPath })
      expect('error' in socket, 'AUTH_ADMISSION_WS_UNEXPECTED_SUCCESS').toBe(true)
      const socketError = 'error' in socket ? socket.error : ''
      expect(
        isAdmissionDenied(socketError) ||
          isPublicFunctionMissing(socketError) ||
          isInconclusiveSocketClose(socketError),
        `AUTH_ADMISSION_WS_UNEXPECTED_ERROR: ${socketError}`,
      ).toBe(true)
      expect(await rootControl(), 'AUTH_ADMISSION_WS_ROOT_AFTER').toBe(true)
      expect(await readCanary(), 'AUTH_ADMISSION_COMPONENT_CONTROL_AFTER').toBe(true)
    } finally {
      await client.function(adapter.remove, componentPath, {
        model: 'session',
        where: [{ field: 'id', value: args.sessionId }],
      })
      await client.function(adapter.remove, componentPath, {
        model: 'user',
        where: [{ field: 'id', value: args.userId }],
      })
    }
  })

  it('runs on a backend without URL.canParse, as the OAuth provider fill expects', async () => {
    const capabilities = await client.query(race.runtimeCapabilities, {})
    expect(capabilities, 'AUTH_RUNTIME_URL_CAN_PARSE_CAPABILITY_DRIFT').toEqual({
      urlCanParse: 'undefined',
    })
  })

  it('lets exactly one concurrent create win a logical id, a unique key and a compound identity', async () => {
    const sameId = { id: 'bcn-auth-concurrency-v2-same-id', key: 'bcn-auth-concurrency-v2-key' }
    const sameKey = { id: 'bcn-auth-concurrency-v2-id', key: 'bcn-auth-concurrency-v2-same-key' }
    for (const row of [sameId, sameKey]) await client.mutation(race.remove, { id: row.id })

    const ids = await runRace(url, adminKey, lanes, iterations, (lane, laneIndex, index) =>
      lane.mutation(race.create, { id: sameId.id, key: `${sameId.key}-${laneIndex}-${index}` }),
    )
    expect(winners(ids), 'AUTH_ID_RACE_WINNER_COUNT').toBe(1)
    expect(failures(ids), 'AUTH_ID_RACE_UNEXPECTED_FAILURE').toEqual(['AUTH_LOGICAL_ID_CONFLICT'])

    const keys = await runRace(url, adminKey, lanes, iterations, (lane, laneIndex, index) =>
      lane.mutation(race.create, { id: `${sameKey.id}-${laneIndex}-${index}`, key: sameKey.key }),
    )
    expect(winners(keys), 'AUTH_UNIQUE_RACE_WINNER_COUNT').toBe(1)
    expect(failures(keys), 'AUTH_UNIQUE_RACE_UNEXPECTED_FAILURE').toEqual([
      'AUTH_UNIQUE_CONFLICT:rateLimit.key',
    ])

    const account = {
      id: 'bcn-auth-concurrency-v1-compound-account-row',
      accountId: 'bcn-auth-concurrency-v1-compound-account',
    }
    await client.function(adapter.remove, componentPath, {
      model: 'account',
      where: [
        { field: 'providerId', value: compoundAccountProvider },
        { field: 'accountId', value: account.accountId },
      ],
    })
    await client.function(adapter.remove, componentPath, {
      model: 'user',
      where: [{ field: 'id', value: `${account.id}-user` }],
    })
    await client.function(adapter.create, componentPath, {
      model: 'user',
      data: {
        createdAt: 1_700_000_000_000,
        email: `${account.id}@example.test`,
        emailVerified: true,
        id: `${account.id}-user`,
        name: account.id,
        updatedAt: 1_700_000_000_000,
      },
    })
    const identities = await runRace(url, adminKey, lanes, 1, (lane, laneIndex, index) =>
      lane.function(adapter.create, componentPath, {
        model: 'account',
        data: {
          createdAt: 1_700_000_000_000,
          id: `${account.id}-${laneIndex}-${index}`,
          accountId: account.accountId,
          providerId: compoundAccountProvider,
          updatedAt: 1_700_000_000_000,
          userId: `${account.id}-user`,
        },
      }),
    )
    expect(winners(identities), 'AUTH_COMPOUND_UNIQUE_RACE_WINNER_COUNT').toBe(1)
    expect(failures(identities), 'AUTH_COMPOUND_UNIQUE_RACE_UNEXPECTED_FAILURE').toEqual([
      'AUTH_UNIQUE_CONFLICT:account.providerId_accountId',
    ])
  })

  it('consumes a row once and loses no concurrent increment', async () => {
    const consume = {
      id: 'bcn-auth-concurrency-v1-consume',
      key: 'bcn-auth-concurrency-v1-consume',
    }
    const increment = {
      id: 'bcn-auth-concurrency-v1-increment',
      key: 'bcn-auth-concurrency-v1-increment',
    }
    for (const row of [consume, increment]) await client.mutation(race.remove, { id: row.id })

    await client.mutation(race.create, consume)
    const consumed = await runRace(url, adminKey, lanes, iterations, (lane) =>
      lane.mutation(race.consume, { id: consume.id }),
    )
    expect(winners(consumed), 'AUTH_CONSUME_RACE_REQUEST_FAILURE').toBe(consumed.length)
    expect(
      consumed.filter((result) => result.value !== null),
      'AUTH_CONSUME_RACE_WINNER_COUNT',
    ).toHaveLength(1)

    await client.mutation(race.create, increment)
    const incrementLanes = 2
    const incremented = await runRace(
      url,
      adminKey,
      incrementLanes,
      totalRequests / incrementLanes,
      (lane) => lane.mutation(race.increment, { id: increment.id }),
      true,
    )
    expect(failures(incremented), 'AUTH_INCREMENT_RACE_REQUEST_FAILURE').toEqual([])
    const row = await client.query(race.read, { id: increment.id })
    expect(isRecord(row) && row.count, 'AUTH_INCREMENT_RACE_LOST_UPDATE').toBe(totalRequests)
  })

  it('rolls back every write when an adapter trigger throws', async () => {
    const rows = {
      consumeFault: {
        id: 'bcn-auth-concurrency-v1-consume-trigger-fault',
        key: 'bcn-auth-concurrency-v1-consume-trigger-fault',
      },
      incrementFault: {
        id: 'bcn-auth-concurrency-v1-increment-update-trigger-fault',
        key: 'bcn-auth-concurrency-v1-increment-trigger-fault',
      },
      updateManyPass: {
        id: 'bcn-auth-concurrency-v1-update-many-pass',
        key: 'bcn-auth-concurrency-v1-update-many-fault-0',
      },
      updateManyFault: {
        id: 'bcn-auth-concurrency-v1-update-many-update-trigger-fault',
        key: 'bcn-auth-concurrency-v1-update-many-fault-1',
      },
    }
    for (const row of Object.values(rows)) await client.mutation(race.remove, { id: row.id })
    const failureOf = async (invoke: () => Promise<unknown>) =>
      failureClass(await rejection(invoke))
    const pristine = async (row: { id: string; key: string }, code: string) => {
      expect(await client.query(race.read, { id: row.id }), code).toMatchObject({
        id: row.id,
        key: row.key,
        count: 0,
        lastRequest: 0,
      })
    }

    await client.mutation(race.create, rows.consumeFault)
    expect(
      await failureOf(() =>
        client.mutation(race.consumeWithFailingTrigger, { id: rows.consumeFault.id }),
      ),
      'AUTH_CONSUME_TRIGGER_FAULT_NOT_OBSERVED',
    ).toBe('AUTH_TRIGGER_FAULT_INJECTED')
    await pristine(rows.consumeFault, 'AUTH_CONSUME_TRIGGER_FAULT_DID_NOT_ROLL_BACK')

    await client.mutation(race.create, rows.incrementFault)
    expect(
      await failureOf(() =>
        client.mutation(race.incrementWithFailingTrigger, { id: rows.incrementFault.id }),
      ),
      'AUTH_INCREMENT_TRIGGER_FAULT_NOT_OBSERVED',
    ).toBe('AUTH_TRIGGER_FAULT_INJECTED')
    await pristine(rows.incrementFault, 'AUTH_INCREMENT_TRIGGER_FAULT_DID_NOT_ROLL_BACK')

    await client.mutation(race.create, rows.updateManyPass)
    await client.mutation(race.create, rows.updateManyFault)
    expect(
      await failureOf(() =>
        client.mutation(race.updateManyWithFailingTrigger, {
          keyPrefix: 'bcn-auth-concurrency-v1-update-many-fault-',
        }),
      ),
      'AUTH_UPDATE_MANY_TRIGGER_FAULT_NOT_OBSERVED',
    ).toBe('AUTH_TRIGGER_FAULT_INJECTED')
    await pristine(rows.updateManyPass, 'AUTH_UPDATE_MANY_EARLIER_ROW_DID_NOT_ROLL_BACK')
    await pristine(rows.updateManyFault, 'AUTH_UPDATE_MANY_FAULT_ROW_DID_NOT_ROLL_BACK')

    const created = {
      id: 'bcn-auth-concurrency-v2-trigger-fault',
      key: 'bcn-auth-concurrency-v2-trigger-fault',
    }
    expect(
      await failureOf(() => client.mutation(race.createWithFailingTrigger, created)),
      'AUTH_TRIGGER_FAULT_NOT_OBSERVED',
    ).toBe('AUTH_TRIGGER_FAULT_INJECTED')
    expect(
      await client.query(race.read, { id: created.id }),
      'AUTH_TRIGGER_FAULT_DID_NOT_ROLL_BACK',
    ).toBeNull()
  })

  it('counts rate limits exactly per signed client IP and resets after the window', async () => {
    const statuses = (responses: Response[]) => responses.map((response) => response.status)
    const where = [{ field: 'key', value: '192.0.2.20|/get-session' }]

    const cold = await Promise.all(
      Array.from({ length: 40 }, () => getSession(siteUrl, '192.0.2.20')),
    )
    expect(statuses(cold), 'AUTH_RATE_LIMIT_COLD_START_FAILURE').toEqual(Array(40).fill(200))
    expect(
      await client.function(adapter.count, componentPath, { model: 'rateLimit', where }),
      'AUTH_RATE_LIMIT_COLD_START_DUPLICATE_ROWS',
    ).toBe(1)
    expect(
      await client.function(adapter.findOne, componentPath, { model: 'rateLimit', where }),
      'AUTH_RATE_LIMIT_COLD_START_COUNT',
    ).toMatchObject({ count: 40 })

    const warm = await Promise.all(
      Array.from({ length: 40 }, () => getSession(siteUrl, '192.0.2.20')),
    )
    expect(statuses(warm), 'AUTH_RATE_LIMIT_WARM_FAILURE').toEqual(Array(40).fill(200))
    const limit = await Promise.all(
      Array.from({ length: 21 }, () => getSession(siteUrl, '192.0.2.20')),
    )
    expect(
      statuses(limit).filter((status) => status === 200),
      'AUTH_RATE_LIMIT_EXACT_LIMIT_FAILURE',
    ).toHaveLength(20)
    expect(
      statuses(limit).filter((status) => status === 429),
      'AUTH_RATE_LIMIT_EXACT_LIMIT_FAILURE',
    ).toHaveLength(1)
    const retryAfter = Number(
      limit.find((response) => response.status === 429)?.headers.get('x-retry-after'),
    )
    expect(
      Number.isSafeInteger(retryAfter) && retryAfter > 0 && retryAfter <= 10,
      'AUTH_RATE_LIMIT_RETRY_AFTER_INVALID',
    ).toBe(true)
    expect(
      await client.function(adapter.findOne, componentPath, { model: 'rateLimit', where }),
      'AUTH_RATE_LIMIT_EXACT_FINAL_COUNT',
    ).toMatchObject({ count: 100 })
    expect(
      (await getSession(siteUrl, '192.0.2.21')).status,
      'AUTH_RATE_LIMIT_INDEPENDENT_KEY_FAILURE',
    ).toBe(200)

    const signed = await Promise.all(
      Array.from({ length: 4 }, () => signedSignIn(siteUrl, '192.0.2.10')),
    )
    expect(
      statuses(signed).filter((status) => status === 429),
      'AUTH_RATE_LIMIT_ATOMICITY',
    ).toHaveLength(1)
    expect(
      (await signedSignIn(siteUrl, '192.0.2.11')).status,
      'AUTH_RATE_LIMIT_CROSS_IP_LEAK',
    ).not.toBe(429)

    const forged = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        signedSignIn(siteUrl, `198.51.100.${index + 1}`, 'A'.repeat(43)),
      ),
    )
    expect(statuses(forged), 'AUTH_FORGED_IP_PAIR_NOT_REJECTED').toEqual([500, 500, 500, 500])
    for (const response of forged) {
      expect(await response.json(), 'AUTH_FORGED_IP_REJECTION_DISCLOSED_DETAILS').toMatchObject({
        code: 'AUTH_REQUEST_METADATA_INVALID',
      })
    }
    const direct = await Promise.all(Array.from({ length: 4 }, () => directSignIn(siteUrl)))
    expect(
      statuses(direct).filter((status) => status === 429),
      'AUTH_DIRECT_IP_RATE_LIMIT_ATOMICITY',
    ).toHaveLength(1)
    expect(
      (await signedSignIn(siteUrl, '192.0.2.12')).status,
      'AUTH_FORGED_IP_POISONED_SIGNED_BUCKET',
    ).not.toBe(429)
    await sleep(10_500)
    expect(
      (await signedSignIn(siteUrl, '192.0.2.10')).status,
      'AUTH_RATE_LIMIT_WINDOW_DID_NOT_RESET',
    ).not.toBe(429)
  })

  it('keeps one active signing key through concurrent rotation and publishes only public keys', async () => {
    const activeKeys = async () => {
      const state = (await client.query(race.jwksState, {})) as Array<{ expiresAt: unknown }>
      return state.filter((key) => key.expiresAt === null).length
    }
    const pretraffic = (await client.action(race.rotate, {})) as { newKid: string }
    expect(privateJwkMembers(pretraffic), 'AUTH_JWKS_PRIVATE_LEAK').toEqual([])
    expect(await activeKeys(), 'AUTH_JWKS_PRETRAFFIC_ACTIVE_COUNT').toBe(1)

    const rotations = (await Promise.all(
      Array.from({ length: 8 }, () => client.action(race.rotate, {})),
    )) as Array<{ newKid: string }>
    expect(privateJwkMembers(rotations), 'AUTH_JWKS_PRIVATE_LEAK').toEqual([])
    expect(await activeKeys(), 'AUTH_JWKS_ACTIVE_COUNT').toBe(1)

    const response = await fetch(`${siteUrl}/api/auth/jwks`, { headers: { origin: authOrigin } })
    expect(response.ok, 'AUTH_JWKS_PUBLIC_FETCH_FAILED').toBe(true)
    const published = (await response.json()) as { keys?: Array<{ kid: string }> }
    expect(privateJwkMembers(published), 'AUTH_JWKS_PRIVATE_LEAK').toEqual([])
    expect(Array.isArray(published.keys), 'AUTH_JWKS_PUBLIC_SHAPE_INVALID').toBe(true)
    const kids = new Set(published.keys!.map((key) => key.kid))
    for (const rotation of [pretraffic, ...rotations]) {
      expect(kids.has(rotation.newKid), 'AUTH_JWKS_RACE_KEY_NOT_PUBLISHED').toBe(true)
    }
  })
})
