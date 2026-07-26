import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { resolve } from 'node:path'

const ARGUMENT_SENTINEL = 'PACKED_SERVER_ARGUMENT_SENTINEL_63dff0c4'
const UPSTREAM_SENTINEL = 'PACKED_SERVER_UPSTREAM_SENTINEL_a72bb891'
const CREDENTIAL_SENTINEL = 'PACKED_SERVER_CREDENTIAL_SENTINEL_177e5ec0'
const operations = ['query', 'mutation', 'action']
const scenarios = ['success', 'structured', 'plain', 'transport', 'required-auth']
const requests = []
const violations = []

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

async function readBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 64 * 1024) throw new Error('Convex probe request body exceeded 64 KiB')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function startConvexProtocolServer() {
  const server = createServer(async (request, response) => {
    try {
      const endpointOperation = {
        '/api/query': 'query',
        '/api/mutation': 'mutation',
        '/api/action': 'action',
      }[request.url ?? '']
      invariant(request.method === 'POST' && endpointOperation, 'unexpected Convex probe request')
      invariant(!request.headers.authorization, 'anonymous server call forwarded authorization')
      invariant(!request.headers.cookie, 'anonymous server call forwarded cookies')

      const body = JSON.parse(await readBody(request))
      const match =
        /^serverProbe:(query|mutation|action)-(success|structured|plain|transport)$/u.exec(
          body.path,
        )
      invariant(match, 'unexpected Convex probe function path')
      const [, operation, scenario] = match
      invariant(operation === endpointOperation, 'function kind used the wrong Convex endpoint')
      invariant(body.format === 'convex_encoded_json', 'unexpected Convex request format')
      invariant(
        body.args?.[0]?.sentinel === ARGUMENT_SENTINEL,
        'server call arguments did not reach the Convex protocol boundary',
      )
      requests.push({ operation, scenario })

      if (scenario === 'transport') {
        request.socket.destroy()
        return
      }
      if (scenario === 'structured') {
        sendJson(response, 560, {
          status: 'error',
          errorMessage: `Structured packed server failure ${UPSTREAM_SENTINEL}\n    at handler (../convex/private.ts:1:1)`,
          errorData: {
            code: 'PACKED_SERVER_STRUCTURED',
            operation,
          },
        })
        return
      }
      if (scenario === 'plain') {
        sendJson(response, 560, {
          status: 'error',
          errorMessage: `${UPSTREAM_SENTINEL}:${ARGUMENT_SENTINEL}`,
        })
        return
      }
      sendJson(response, 200, {
        status: 'success',
        value: { operation, scenario },
      })
    } catch (error) {
      violations.push(error instanceof Error ? error.message : 'unknown protocol violation')
      if (!response.headersSent) sendJson(response, 500, { status: 'probe_failure' })
      else response.end()
    }
  })
  return server
}

async function listen(server) {
  await new Promise((ready, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', ready)
  })
  const address = server.address()
  invariant(address && typeof address !== 'string', 'probe server did not expose a TCP port')
  return address.port
}

async function availablePort() {
  const server = createNetServer()
  const port = await listen(server)
  await new Promise((ready, reject) => server.close((error) => (error ? reject(error) : ready())))
  return port
}

async function waitForNitro(child, origin) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('production Nitro exited before readiness')
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2_000) })
      await response.body?.cancel()
      if (response.ok) return
    } catch {
      // Nitro may refuse connections until its listener is ready.
    }
    await new Promise((ready) => setTimeout(ready, 100))
  }
  throw new Error('production Nitro did not become ready within 30 seconds')
}

async function stopChild(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    new Promise((ready) => child.once('exit', () => ready(true))),
    new Promise((ready) => setTimeout(() => ready(false), 2_000)),
  ])
  if (stopped) return
  child.kill('SIGKILL')
  if (child.exitCode === null) await new Promise((ready) => child.once('exit', ready))
}

function expectedError(scenario) {
  switch (scenario) {
    case 'structured':
      return { kind: 'server', message: 'Convex application error' }
    case 'plain':
      return { kind: 'unknown', message: 'Unknown Convex error' }
    case 'transport':
      return { kind: 'transport', message: 'Convex HTTP request could not complete' }
    case 'required-auth':
      return {
        kind: 'authentication',
        message: 'Convex authentication is required for this server call',
        status: 401,
      }
    default:
      throw new Error(`scenario ${scenario} has no expected error`)
  }
}

async function invoke(origin, operation, scenario) {
  const response = await fetch(
    `${origin}/api/server-consumer-smoke?operation=${operation}&scenario=${scenario}`,
    {
      headers:
        scenario === 'required-auth'
          ? undefined
          : {
              authorization: `Bearer ${CREDENTIAL_SENTINEL}`,
              cookie: `better-auth.session_token=${CREDENTIAL_SENTINEL}`,
            },
      signal: AbortSignal.timeout(10_000),
    },
  )
  invariant(response.status === 200, `${operation}/${scenario} returned HTTP ${response.status}`)
  return await response.json()
}

const convexServer = startConvexProtocolServer()
let nitro
let nitroOutput = ''

try {
  const convexPort = await listen(convexServer)
  const nitroPort = await availablePort()
  const convexUrl = `http://127.0.0.1:${convexPort}`
  const nitroOrigin = `http://127.0.0.1:${nitroPort}`
  const environment = {
    ...process.env,
    BCN_AUTH_PROXY_IP_SECRET: 'packed-server-proxy-secret-32-characters',
    BETTER_AUTH_SECRETS: '1:packed-server-auth-secret-32-characters',
    HOST: '127.0.0.1',
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(nitroPort),
    NODE_ENV: 'production',
    PORT: String(nitroPort),
    SERVER_CONSUMER_CONVEX_SITE_URL: convexUrl,
    SERVER_CONSUMER_CONVEX_URL: convexUrl,
    SITE_URL: nitroOrigin,
  }

  execFileSync('pnpm', ['exec', 'nuxi', 'build'], {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  })

  nitro = spawn(process.execPath, [resolve('.output/server/index.mjs')], {
    cwd: process.cwd(),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  nitro.stdout.setEncoding('utf8')
  nitro.stderr.setEncoding('utf8')
  nitro.stdout.on('data', (chunk) => {
    nitroOutput += chunk
  })
  nitro.stderr.on('data', (chunk) => {
    nitroOutput += chunk
  })
  await waitForNitro(nitro, nitroOrigin)

  for (const operation of operations) {
    for (const scenario of scenarios) {
      const dispatchedBefore = requests.length
      const result = await invoke(nitroOrigin, operation, scenario)
      if (scenario === 'success') {
        invariant(result.ok === true, `${operation}/success did not succeed`)
        invariant(
          result.result?.operation === operation,
          `${operation}/success returned wrong kind`,
        )
        invariant(
          result.result?.scenario === scenario,
          `${operation}/success returned wrong result`,
        )
        continue
      }

      invariant(result.ok === false, `${operation}/${scenario} did not return a safe error`)
      const expected = expectedError(scenario)
      invariant(result.error?.kind === expected.kind, `${operation}/${scenario} had wrong kind`)
      invariant(
        result.error?.message === expected.message,
        `${operation}/${scenario} had wrong public message`,
      )
      if ('status' in expected) {
        invariant(
          result.error?.status === expected.status,
          `${operation}/${scenario} had wrong status`,
        )
      }
      if (scenario === 'structured') {
        invariant(
          result.error?.code === 'PACKED_SERVER_STRUCTURED',
          `${operation}/structured lost its code`,
        )
        invariant(
          result.error?.data?.operation === operation,
          `${operation}/structured lost its data`,
        )
      }
      invariant(!result.enumerableKeys.includes('cause'), `${operation}/${scenario} exposed cause`)
      invariant(
        !result.stringified.includes(UPSTREAM_SENTINEL) &&
          !result.stringified.includes(ARGUMENT_SENTINEL) &&
          !result.stringified.includes(CREDENTIAL_SENTINEL),
        `${operation}/${scenario} serialized a sentinel`,
      )
      if (scenario === 'required-auth') {
        invariant(
          requests.length === dispatchedBefore,
          `${operation}/required-auth dispatched to Convex`,
        )
      }
    }
  }

  invariant(violations.length === 0, `Convex protocol violations: ${violations.join('; ')}`)
  invariant(requests.length === 12, `expected 12 Convex dispatches, received ${requests.length}`)
  for (const sentinel of [ARGUMENT_SENTINEL, UPSTREAM_SENTINEL, CREDENTIAL_SENTINEL]) {
    invariant(!nitroOutput.includes(sentinel), `production Nitro output leaked ${sentinel}`)
  }
} catch (error) {
  if (nitroOutput) process.stderr.write(nitroOutput)
  throw error
} finally {
  if (nitro) await stopChild(nitro)
  await new Promise((ready, reject) =>
    convexServer.close((error) => (error ? reject(error) : ready())),
  )
}
