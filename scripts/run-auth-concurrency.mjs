import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { createJiti } from 'jiti'

import {
  hasCompleteSessionAdmissionBoundaryEvidence,
  verifySessionAdmissionBoundary,
} from './auth-session-admission.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const sourcePlayground = join(root, 'playground')

export const authConcurrencyFunctions = {
  create: makeFunctionReference('authConcurrency:createRaceRow'),
  createWithFailingTrigger: makeFunctionReference(
    'authConcurrency:createRaceRowWithFailingTrigger',
  ),
  consume: makeFunctionReference('authConcurrency:consumeRaceRow'),
  consumeWithFailingTrigger: makeFunctionReference(
    'authConcurrency:consumeRaceRowWithFailingTrigger',
  ),
  increment: makeFunctionReference('authConcurrency:incrementRaceRow'),
  incrementWithFailingTrigger: makeFunctionReference(
    'authConcurrency:incrementRaceRowWithFailingTrigger',
  ),
  jwksState: makeFunctionReference('authConcurrency:readJwksRaceState'),
  read: makeFunctionReference('authConcurrency:readRaceRow'),
  runtimeCapabilities: makeFunctionReference('authConcurrency:readRuntimeCapabilities'),
  requestContext: makeFunctionReference('authRequestContext:prove'),
  remove: makeFunctionReference('authConcurrency:deleteRaceRow'),
  rotate: makeFunctionReference('authConcurrency:rotateSigningKeyRace'),
  updateManyWithFailingTrigger: makeFunctionReference(
    'authConcurrency:updateRaceRowsWithFailingTrigger',
  ),
}

export const authAdapterComponentFunctions = {
  create: makeFunctionReference('adapter:create'),
  findOne: makeFunctionReference('adapter:findOne'),
  increment: makeFunctionReference('adapter:incrementOne'),
  remove: makeFunctionReference('adapter:deleteMany'),
  sessionAdmission: makeFunctionReference('adapter:sessionAdmission'),
}

export const authOperatorFunctions = {
  rotate: makeFunctionReference('auth:rotateSigningKey'),
}

const proxyIpSecret = 'better-convex-nuxt-e2e-proxy-ip-secret-32-bytes'
const authComponentPath = 'betterAuth'
const compoundAccountProvider = 'bcn-compound-race'
const compoundAccountIssuer = 'https://bcn-compound-race.example.test'
export const AUTH_CONTENTION_MAX_RETRIES = 5

export function safeAuthConcurrencyFailure(error) {
  const text = error instanceof Error ? error.message : String(error)
  if (text.includes('AUTH_LOGICAL_ID_CONFLICT')) return 'AUTH_LOGICAL_ID_CONFLICT'
  if (text.includes('AUTH_UNIQUE_CONFLICT:rateLimit.id')) return 'AUTH_LOGICAL_ID_CONFLICT'
  const uniqueConflict = /AUTH_UNIQUE_CONFLICT:[\w.]+/u.exec(text)?.[0]
  if (uniqueConflict) return uniqueConflict
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

export function shouldRetryAuthContention(operation, failure, attempt) {
  return (
    (operation === 'increment' || operation === 'componentIncrement') &&
    failure === 'CONVEX_CONTENTION' &&
    Number.isSafeInteger(attempt) &&
    attempt >= 0 &&
    attempt < AUTH_CONTENTION_MAX_RETRIES
  )
}

export function authContentionRetryDelayMs(attempt, workerIndex, operationIndex) {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    !Number.isSafeInteger(workerIndex) ||
    workerIndex < 0 ||
    !Number.isSafeInteger(operationIndex) ||
    operationIndex < 0
  ) {
    throw new TypeError('AUTH_CONTENTION_RETRY_INPUT_INVALID')
  }
  const exponentialMs = Math.min(5 * 2 ** attempt, 80)
  const deterministicJitterMs = (workerIndex * 11 + operationIndex * 7 + attempt * 3) % 7
  return exponentialMs + deterministicJitterMs
}

async function runWorker() {
  const { adminKey, componentPath, id, iterations, key, operation, url, workerIndex } = workerData
  const client = new ConvexHttpClient(url)
  client.setAdminAuth(adminKey)
  const invokeOnce = async (index) => {
    const args =
      operation === 'createSameId' || operation === 'componentCreateSameId'
        ? { id, key: `${key}-${workerIndex}-${index}` }
        : operation === 'createSameKey'
          ? { id: `${id}-${workerIndex}-${index}`, key }
          : operation === 'operatorRotate'
            ? {}
            : { id }
    if (operation === 'componentCreateSameId') {
      return client.function(authAdapterComponentFunctions.create, componentPath, {
        data: { ...args, count: 0, lastRequest: 0 },
        model: 'rateLimit',
      })
    }
    if (operation === 'componentIncrement') {
      return client.function(authAdapterComponentFunctions.increment, componentPath, {
        increment: { count: 1 },
        model: 'rateLimit',
        where: [{ field: 'id', value: id }],
      })
    }
    if (operation === 'createSameAccountIdentity') {
      return client.function(authAdapterComponentFunctions.create, componentPath, {
        model: 'account',
        data: {
          createdAt: 1_700_000_000_000,
          id: `${id}-${workerIndex}-${index}`,
          issuer: compoundAccountIssuer,
          accountId: key,
          providerId: compoundAccountProvider,
          updatedAt: 1_700_000_000_000,
          userId: `${id}-user`,
        },
      })
    }
    if (operation === 'operatorRotate') {
      return client.action(authOperatorFunctions.rotate, {})
    }
    const functionName = operation.startsWith('create') ? 'create' : operation
    return client.mutation(authConcurrencyFunctions[functionName], args)
  }
  const invoke = async (index) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return { ok: true, value: await invokeOnce(index) }
      } catch (error) {
        const failure = safeAuthConcurrencyFailure(error)
        if (!shouldRetryAuthContention(operation, failure, attempt)) {
          return { ok: false, error: failure }
        }
        // A final Convex OCC contention error means the mutation did not commit.
        // Never retry ambiguous transport/action failures: an increment must
        // still correspond to exactly one committed mutation.
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, authContentionRetryDelayMs(attempt, workerIndex, index)),
        )
      }
    }
  }
  // Each worker is one independent client/isolate. Keep its own requests in
  // order so the gate exercises cross-isolate OCC instead of benchmarking how
  // many simultaneous retries a single local backend can queue.
  const results = []
  for (let index = 0; index < iterations; index += 1) results.push(await invoke(index))
  parentPort.postMessage(results)
}

function copyIsolatedPlayground() {
  const parent = mkdtempSync(join(tmpdir(), 'bcn-auth-concurrency-'))
  const cwd = join(parent, 'playground')
  cpSync(sourcePlayground, cwd, {
    recursive: true,
    filter: (source) => {
      const relative = source.slice(sourcePlayground.length).replace(/^\//u, '')
      return !(
        relative === '.env.local' ||
        relative.startsWith('.convex') ||
        relative === 'node_modules' ||
        relative.startsWith('.nuxt') ||
        relative.startsWith('.output')
      )
    },
  })
  const nodeModules = join(cwd, 'node_modules')
  mkdirSync(nodeModules)
  mkdirSync(join(nodeModules, '@lupinum'))
  symlinkSync(join(root, 'src'), join(parent, 'src'), 'dir')
  symlinkSync(join(root, 'node_modules'), join(parent, 'node_modules'), 'dir')
  symlinkSync(join(root, 'node_modules', 'better-auth'), join(nodeModules, 'better-auth'), 'dir')
  symlinkSync(root, join(nodeModules, '@lupinum/better-convex-nuxt'), 'dir')
  symlinkSync(join(root, 'node_modules', 'convex'), join(nodeModules, 'convex'), 'dir')
  const fixturePath = 'test/fixtures/auth-request-context/convex/contextProof.ts'
  mkdirSync(join(parent, 'test/fixtures/auth-request-context/convex'), { recursive: true })
  cpSync(join(root, fixturePath), join(parent, fixturePath))
  writeFileSync(
    join(cwd, 'convex/authRequestContext.ts'),
    `import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { proveWorkforceRequestContext } from '../../test/fixtures/auth-request-context/convex/contextProof'

export const prove = internalAction({
  args: {},
  returns: v.object({
    before: v.number(), adapter: v.number(), sessionAfter: v.number(),
    endpointAfter: v.number(), blank: v.number(),
    outsideWriteRejected: v.boolean(), outsideBinding: v.boolean(), blankBinding: v.boolean(),
  }),
  handler: async () => proveWorkforceRequestContext(),
})
`,
  )
  return { cwd, parent }
}

export function spawnAuthRaceWorkers(
  url,
  adminKey,
  operation,
  id,
  key,
  workers,
  iterations = 1,
  componentPath,
) {
  return Promise.all(
    Array.from(
      { length: workers },
      (_, workerIndex) =>
        new Promise((resolvePromise, reject) => {
          const worker = new Worker(new URL(import.meta.url), {
            env: {},
            workerData: {
              adminKey,
              componentPath,
              id,
              iterations,
              key,
              operation,
              url,
              workerIndex,
            },
          })
          const timer = setTimeout(() => {
            worker.terminate().catch(() => {})
            reject(new Error(`AUTH_CONCURRENCY_WORKER_TIMEOUT:${operation}`))
          }, 120_000)
          worker.once('message', (value) => {
            clearTimeout(timer)
            resolvePromise(value)
          })
          worker.once('error', (error) => {
            clearTimeout(timer)
            reject(error)
          })
          worker.once('exit', (code) => {
            if (code !== 0) {
              clearTimeout(timer)
              reject(new Error(`AUTH_CONCURRENCY_WORKER_EXIT:${operation}:${code}`))
            }
          })
        }),
    ),
  ).then((groups) => groups.flat())
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertOnlyFailure(results, expected, message) {
  assert(
    results.filter((result) => !result.ok).every((result) => result.error === expected),
    message,
  )
}

function assertPristineRaceRow(row, expected, message) {
  assert(
    row?.id === expected.id && row.key === expected.key && row.count === 0 && row.lastRequest === 0,
    message,
  )
}

function failureSummary(results) {
  const counts = new Map()
  for (const result of results) {
    if (result.ok) continue
    counts.set(result.error, (counts.get(result.error) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}=${count}`)
    .join(', ')
}

function signClientIp(clientIp) {
  return createHmac('sha256', proxyIpSecret).update(`v1\n${clientIp}`).digest('base64url')
}

async function limitedSignIn(siteUrl, clientIp, signature = signClientIp(clientIp)) {
  return fetch(`${siteUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3050',
      'x-bcn-client-ip': clientIp,
      'x-bcn-client-ip-signature': signature,
    },
    body: JSON.stringify({
      email: 'rate-limit-missing@example.test',
      password: 'not-a-real-password',
    }),
  })
}

async function directSignIn(siteUrl) {
  return fetch(`${siteUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3050',
    },
    body: JSON.stringify({
      email: 'rate-limit-missing@example.test',
      password: 'not-a-real-password',
    }),
  })
}

export function assertNoPrivateJwkMaterial(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateJwkMaterial(entry, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [name, child] of Object.entries(value)) {
    assert(
      !['d', 'p', 'q', 'dp', 'dq', 'qi', 'privateKey'].includes(name),
      `AUTH_JWKS_PRIVATE_LEAK:${path}.${name}`,
    )
    assertNoPrivateJwkMaterial(child, `${path}.${name}`)
  }
}

function readLocalAdminKey(cwd) {
  let config
  try {
    config = JSON.parse(readFileSync(join(cwd, '.convex/local/default/config.json'), 'utf8'))
  } catch {
    throw new Error('AUTH_CONCURRENCY_LOCAL_ADMIN_KEY_MISSING')
  }
  if (
    typeof config?.adminKey !== 'string' ||
    typeof config?.deploymentName !== 'string' ||
    !config.adminKey.startsWith(`${config.deploymentName}|`) ||
    config.adminKey.length < config.deploymentName.length + 34
  ) {
    throw new Error('AUTH_CONCURRENCY_LOCAL_ADMIN_KEY_INVALID')
  }
  return config.adminKey
}

async function runMain() {
  const args = process.argv.slice(2)
  assert(
    args.length === 0 || (args.length === 1 && args[0] === '--request-context-only'),
    'AUTH_CONCURRENCY_ARGUMENT_INVALID',
  )
  const requestContextOnly = args[0] === '--request-context-only'
  process.env.CONVEX_E2E_AUTO_START = 'true'
  process.env.BCN_E2E_REQUIRE_LOCAL = 'true'
  execFileSync('pnpm', ['exec', 'nuxt-module-build', 'prepare'], {
    cwd: root,
    stdio: 'inherit',
  })
  execFileSync('pnpm', ['exec', 'nuxt-module-build', 'build'], {
    cwd: root,
    stdio: 'inherit',
  })
  const isolated = copyIsolatedPlayground()
  const jiti = createJiti(import.meta.url, { interopDefault: false })
  const { ensureLocalConvex } = await jiti.import('../test/helpers/local-convex.ts')
  let local
  try {
    local = await ensureLocalConvex({ cwd: isolated.cwd, timeoutMs: 120_000 })
    const url = local.env.CONVEX_URL
    const siteUrl = local.env.CONVEX_SITE_URL
    assert(typeof url === 'string', 'AUTH_CONCURRENCY_URL_MISSING')
    assert(typeof siteUrl === 'string', 'AUTH_CONCURRENCY_SITE_URL_MISSING')
    const adminKey = readLocalAdminKey(isolated.cwd)
    const client = new ConvexHttpClient(url)
    client.setAdminAuth(adminKey)
    const boundaryEvidence = await verifySessionAdmissionBoundary({
      url,
      adminClient: client,
      adminKey,
      root,
      componentFunctions: authAdapterComponentFunctions,
      componentPath: authComponentPath,
    })
    const contextProof = await client.action(authConcurrencyFunctions.requestContext, {})
    assert(
      contextProof.before === 2 &&
        contextProof.adapter === 2 &&
        contextProof.sessionAfter === 2 &&
        contextProof.endpointAfter === 2 &&
        contextProof.blank === 2 &&
        contextProof.outsideWriteRejected === true &&
        contextProof.outsideBinding === false &&
        contextProof.blankBinding === false,
      'AUTH_REQUEST_CONTEXT_RUNTIME_PROOF_FAILED',
    )
    console.log(
      'Convex V8 workforce context: HTTP hooks, memory adapter, relay and isolation passed.',
    )
    console.log(JSON.stringify({ contextPassed: true, ...boundaryEvidence }))
    if (requestContextOnly) return
    assert(
      hasCompleteSessionAdmissionBoundaryEvidence(boundaryEvidence),
      'AUTH_ADMISSION_BOUNDARY_EVIDENCE_INCOMPLETE',
    )
    const runtimeCapabilities = await client.query(authConcurrencyFunctions.runtimeCapabilities, {})
    assert(
      runtimeCapabilities?.urlCanParse === 'undefined',
      'AUTH_RUNTIME_URL_CAN_PARSE_CAPABILITY_DRIFT',
    )
    const totalRequests = process.env.BCN_AUTH_CONCURRENCY_LOAD === 'nightly' ? 1_000 : 200
    const workers = totalRequests === 1_000 ? 50 : 20
    const incrementWorkers = 2
    const iterations = totalRequests / workers
    const rows = {
      sameId: { id: 'bcn-auth-concurrency-v2-same-id', key: 'bcn-auth-concurrency-v2-key' },
      sameKey: { id: 'bcn-auth-concurrency-v2-id', key: 'bcn-auth-concurrency-v2-same-key' },
      consume: { id: 'bcn-auth-concurrency-v1-consume', key: 'bcn-auth-concurrency-v1-consume' },
      increment: {
        id: 'bcn-auth-concurrency-v1-increment',
        key: 'bcn-auth-concurrency-v1-increment',
      },
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
    const compoundAccount = {
      id: 'bcn-auth-concurrency-v1-compound-account-row',
      accountId: 'bcn-auth-concurrency-v1-compound-account',
    }
    for (const row of Object.values(rows)) {
      await client.mutation(authConcurrencyFunctions.remove, { id: row.id })
    }
    const sameId = await spawnAuthRaceWorkers(
      url,
      adminKey,
      'createSameId',
      rows.sameId.id,
      rows.sameId.key,
      workers,
      iterations,
    )
    assert(sameId.filter((result) => result.ok).length === 1, 'AUTH_ID_RACE_WINNER_COUNT')
    assertOnlyFailure(sameId, 'AUTH_LOGICAL_ID_CONFLICT', 'AUTH_ID_RACE_UNEXPECTED_FAILURE')

    const sameKey = await spawnAuthRaceWorkers(
      url,
      adminKey,
      'createSameKey',
      rows.sameKey.id,
      rows.sameKey.key,
      workers,
      iterations,
    )
    assert(sameKey.filter((result) => result.ok).length === 1, 'AUTH_UNIQUE_RACE_WINNER_COUNT')
    assertOnlyFailure(
      sameKey,
      'AUTH_UNIQUE_CONFLICT:rateLimit.key',
      'AUTH_UNIQUE_RACE_UNEXPECTED_FAILURE',
    )

    await client.function(authAdapterComponentFunctions.remove, authComponentPath, {
      model: 'account',
      where: [
        { field: 'issuer', value: compoundAccountIssuer },
        { field: 'accountId', value: compoundAccount.accountId },
      ],
    })
    await client.function(authAdapterComponentFunctions.remove, authComponentPath, {
      model: 'user',
      where: [{ field: 'id', value: `${compoundAccount.id}-user` }],
    })
    await client.function(authAdapterComponentFunctions.create, authComponentPath, {
      model: 'user',
      data: {
        createdAt: 1_700_000_000_000,
        email: `${compoundAccount.id}@example.test`,
        emailVerified: true,
        id: `${compoundAccount.id}-user`,
        name: compoundAccount.id,
        updatedAt: 1_700_000_000_000,
      },
    })
    const sameAccountIdentity = await spawnAuthRaceWorkers(
      url,
      adminKey,
      'createSameAccountIdentity',
      compoundAccount.id,
      compoundAccount.accountId,
      workers,
      1,
      authComponentPath,
    )
    assert(
      sameAccountIdentity.filter((result) => result.ok).length === 1,
      'AUTH_COMPOUND_UNIQUE_RACE_WINNER_COUNT',
    )
    assertOnlyFailure(
      sameAccountIdentity,
      'AUTH_UNIQUE_CONFLICT:account.issuer_accountId',
      'AUTH_COMPOUND_UNIQUE_RACE_UNEXPECTED_FAILURE',
    )

    await client.mutation(authConcurrencyFunctions.create, rows.consume)
    const consumed = await spawnAuthRaceWorkers(
      url,
      adminKey,
      'consume',
      rows.consume.id,
      rows.consume.key,
      workers,
      iterations,
    )
    assert(
      consumed.every((result) => result.ok),
      'AUTH_CONSUME_RACE_REQUEST_FAILURE',
    )
    assert(
      consumed.filter((result) => result.value !== null).length === 1,
      'AUTH_CONSUME_RACE_WINNER_COUNT',
    )

    await client.mutation(authConcurrencyFunctions.create, rows.increment)
    const incremented = await spawnAuthRaceWorkers(
      url,
      adminKey,
      'increment',
      rows.increment.id,
      rows.increment.key,
      incrementWorkers,
      totalRequests / incrementWorkers,
    )
    assert(
      incremented.every((result) => result.ok),
      `AUTH_INCREMENT_RACE_REQUEST_FAILURE:${failureSummary(incremented)}`,
    )
    const finalRow = await client.query(authConcurrencyFunctions.read, { id: rows.increment.id })
    assert(finalRow?.count === totalRequests, 'AUTH_INCREMENT_RACE_LOST_UPDATE')

    await client.mutation(authConcurrencyFunctions.create, rows.consumeFault)
    let consumeTriggerFailure = 'MISSING'
    try {
      await client.mutation(authConcurrencyFunctions.consumeWithFailingTrigger, {
        id: rows.consumeFault.id,
      })
    } catch (error) {
      consumeTriggerFailure = safeAuthConcurrencyFailure(error)
    }
    assert(
      consumeTriggerFailure === 'AUTH_TRIGGER_FAULT_INJECTED',
      'AUTH_CONSUME_TRIGGER_FAULT_NOT_OBSERVED',
    )
    assertPristineRaceRow(
      await client.query(authConcurrencyFunctions.read, { id: rows.consumeFault.id }),
      rows.consumeFault,
      'AUTH_CONSUME_TRIGGER_FAULT_DID_NOT_ROLL_BACK',
    )

    await client.mutation(authConcurrencyFunctions.create, rows.incrementFault)
    let incrementTriggerFailure = 'MISSING'
    try {
      await client.mutation(authConcurrencyFunctions.incrementWithFailingTrigger, {
        id: rows.incrementFault.id,
      })
    } catch (error) {
      incrementTriggerFailure = safeAuthConcurrencyFailure(error)
    }
    assert(
      incrementTriggerFailure === 'AUTH_TRIGGER_FAULT_INJECTED',
      'AUTH_INCREMENT_TRIGGER_FAULT_NOT_OBSERVED',
    )
    assertPristineRaceRow(
      await client.query(authConcurrencyFunctions.read, { id: rows.incrementFault.id }),
      rows.incrementFault,
      'AUTH_INCREMENT_TRIGGER_FAULT_DID_NOT_ROLL_BACK',
    )

    await client.mutation(authConcurrencyFunctions.create, rows.updateManyPass)
    await client.mutation(authConcurrencyFunctions.create, rows.updateManyFault)
    let updateManyTriggerFailure = 'MISSING'
    try {
      await client.mutation(authConcurrencyFunctions.updateManyWithFailingTrigger, {
        keyPrefix: 'bcn-auth-concurrency-v1-update-many-fault-',
      })
    } catch (error) {
      updateManyTriggerFailure = safeAuthConcurrencyFailure(error)
    }
    assert(
      updateManyTriggerFailure === 'AUTH_TRIGGER_FAULT_INJECTED',
      'AUTH_UPDATE_MANY_TRIGGER_FAULT_NOT_OBSERVED',
    )
    assertPristineRaceRow(
      await client.query(authConcurrencyFunctions.read, { id: rows.updateManyPass.id }),
      rows.updateManyPass,
      'AUTH_UPDATE_MANY_EARLIER_ROW_DID_NOT_ROLL_BACK',
    )
    assertPristineRaceRow(
      await client.query(authConcurrencyFunctions.read, { id: rows.updateManyFault.id }),
      rows.updateManyFault,
      'AUTH_UPDATE_MANY_FAULT_ROW_DID_NOT_ROLL_BACK',
    )

    const triggerRow = {
      id: 'bcn-auth-concurrency-v2-trigger-fault',
      key: 'bcn-auth-concurrency-v2-trigger-fault',
    }
    let triggerFailure = 'MISSING'
    try {
      await client.mutation(authConcurrencyFunctions.createWithFailingTrigger, triggerRow)
    } catch (error) {
      triggerFailure = safeAuthConcurrencyFailure(error)
    }
    assert(triggerFailure === 'AUTH_TRIGGER_FAULT_INJECTED', 'AUTH_TRIGGER_FAULT_NOT_OBSERVED')
    assert(
      (await client.query(authConcurrencyFunctions.read, { id: triggerRow.id })) === null,
      'AUTH_TRIGGER_FAULT_DID_NOT_ROLL_BACK',
    )

    const signedA = await Promise.all(
      Array.from({ length: 4 }, () => limitedSignIn(siteUrl, '192.0.2.10')),
    )
    assert(
      signedA.filter((response) => response.status === 429).length === 1,
      'AUTH_RATE_LIMIT_ATOMICITY',
    )
    assert(
      (await limitedSignIn(siteUrl, '192.0.2.11')).status !== 429,
      'AUTH_RATE_LIMIT_CROSS_IP_LEAK',
    )

    const forged = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        limitedSignIn(siteUrl, `198.51.100.${index + 1}`, 'A'.repeat(43)),
      ),
    )
    assert(
      forged.every((response) => response.status === 500),
      'AUTH_FORGED_IP_PAIR_NOT_REJECTED',
    )
    const forgedBodies = await Promise.all(forged.map((response) => response.json()))
    assert(
      forgedBodies.every((body) => body?.code === 'AUTH_REQUEST_METADATA_INVALID'),
      'AUTH_FORGED_IP_REJECTION_DISCLOSED_DETAILS',
    )
    const direct = await Promise.all(Array.from({ length: 4 }, () => directSignIn(siteUrl)))
    assert(
      direct.filter((response) => response.status === 429).length === 1,
      'AUTH_DIRECT_IP_RATE_LIMIT_ATOMICITY',
    )
    assert(
      (await limitedSignIn(siteUrl, '192.0.2.12')).status !== 429,
      'AUTH_FORGED_IP_POISONED_SIGNED_BUCKET',
    )
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_500))
    assert(
      (await limitedSignIn(siteUrl, '192.0.2.10')).status !== 429,
      'AUTH_RATE_LIMIT_WINDOW_DID_NOT_RESET',
    )

    const pretrafficKey = await client.action(authConcurrencyFunctions.rotate, {})
    assertNoPrivateJwkMaterial(pretrafficKey)
    let jwksState = await client.query(authConcurrencyFunctions.jwksState, {})
    assert(
      jwksState.filter((key) => key.expiresAt === null).length === 1,
      'AUTH_JWKS_PRETRAFFIC_ACTIVE_COUNT',
    )

    const rotations = await Promise.all(
      Array.from({ length: 8 }, () => client.action(authConcurrencyFunctions.rotate, {})),
    )
    rotations.forEach((rotation) => assertNoPrivateJwkMaterial(rotation))
    jwksState = await client.query(authConcurrencyFunctions.jwksState, {})
    assert(jwksState.filter((key) => key.expiresAt === null).length === 1, 'AUTH_JWKS_ACTIVE_COUNT')
    const publicJwksResponse = await fetch(`${siteUrl}/api/auth/jwks`, {
      headers: { origin: 'http://localhost:3050' },
    })
    assert(publicJwksResponse.ok, 'AUTH_JWKS_PUBLIC_FETCH_FAILED')
    const publicJwks = await publicJwksResponse.json()
    assertNoPrivateJwkMaterial(publicJwks)
    assert(Array.isArray(publicJwks.keys), 'AUTH_JWKS_PUBLIC_SHAPE_INVALID')
    const publishedKids = new Set(publicJwks.keys.map((key) => key.kid))
    for (const rotation of [pretrafficKey, ...rotations]) {
      assert(publishedKids.has(rotation.newKid), 'AUTH_JWKS_RACE_KEY_NOT_PUBLISHED')
    }

    console.log(
      `[auth-concurrency] PASS: pinned real backend lacks URL.canParse as expected; logical-id 1/${sameId.length}, scalar unique-field 1/${sameKey.length}, compound account identity 1/${sameAccountIdentity.length}, consume 1/${consumed.length} across ${workers} worker isolates; increment ${finalRow.count}/${totalRequests} across ${incrementWorkers} sustained worker isolates; create/consume/increment/updateMany trigger rollback, signed-IP quotas/reset, forged-pair rejection, direct-IP fallback, and 8-way official JWKS rotation verified.`,
    )
  } finally {
    await local?.release()
    rmSync(isolated.parent, { recursive: true, force: true })
  }
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMainThread && invokedAsScript) {
  runMain().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
} else if (!isMainThread) {
  runWorker().catch((error) => {
    parentPort.postMessage([{ ok: false, error: safeAuthConcurrencyFailure(error) }])
  })
}
