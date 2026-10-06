// Two independently configured Nuxt proxies, one deployment and host-isolated cookies.
import { createHmac, randomBytes } from 'node:crypto'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { request, type APIRequestContext } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startLocalConvexBackend, type LocalConvexBackend } from '../helpers/local-convex'
import {
  availablePort,
  cleanEnvironment,
  convexCli,
  linkDependencies,
  root,
  runCommand,
  startNuxtServer,
} from './harness'

describe('several site origins over real HTTP', () => {
  let tempRoot: string
  let backend: LocalConvexBackend | undefined
  const servers: Awaited<ReturnType<typeof startNuxtServer>>[] = []
  const clients: APIRequestContext[] = []
  let siteA: APIRequestContext
  let siteB: APIRequestContext
  let originA: string
  let originB: string
  const secret = randomBytes(32).toString('base64url')
  const authSecrets = `1:${randomBytes(32).toString('base64url')}`
  const password = `${randomBytes(24).toString('base64url')}!aA1`
  const email = 'multi-origin@example.test'
  const secrets = [secret, authSecrets, password]

  beforeAll(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'bcn-multi-origin-'))
    const ports = new Set<number>()
    for (let index = 0; index < 4; index += 1) ports.add(await availablePort(ports))
    const [cloudPort, sitePort, portA, portB] = [...ports] as [number, number, number, number]
    originA = `http://localhost:${portA}`
    originB = `http://127.0.0.1:${portB}`
    const appA = join(tempRoot, 'site-a')
    const appB = join(tempRoot, 'site-b')
    for (const cwd of [appA, appB]) {
      await cp(join(root, 'test/fixtures/multi-origin'), cwd, { recursive: true })
      await linkDependencies(cwd)
    }

    backend = await startLocalConvexBackend({
      cwd: appA,
      timeoutMs: 120_000,
      ports: { cloud: cloudPort, site: sitePort },
      devArguments: ['--tail-logs', 'disable', '--typecheck', 'disable'],
      secrets,
    })
    expect(backend.url).toBe(`http://127.0.0.1:${cloudPort}`)
    expect(backend.siteUrl).toBe(`http://127.0.0.1:${sitePort}`)
    for (const [name, value] of [
      ['SITE_URL', originA],
      ['SITE_B_ORIGIN', originB],
      ['BETTER_AUTH_SECRETS', authSecrets],
      ['BCN_AUTH_PROXY_IP_SECRET', secret],
    ] as const) {
      await backend.setEnv(name, value, 4)
    }
    await backend.waitForFunctions()
    await runCommand(
      process.execPath,
      ['--', convexCli, 'run', 'auth:rotateSigningKey', '{}', '--env-file', '.env.local'],
      { cwd: appA, env: cleanEnvironment(), secrets },
    )
    const env = {
      ...cleanEnvironment(),
      BCN_AUTH_PROXY_IP_SECRET: secret,
      NUXT_PUBLIC_CONVEX_URL: backend.url,
      NUXT_PUBLIC_CONVEX_SITE_URL: backend.siteUrl,
    }
    servers.push(await startNuxtServer(appA, originA, env, secrets))
    servers.push(await startNuxtServer(appB, originB, env, secrets))
    siteA = await request.newContext({ baseURL: originA, extraHTTPHeaders: { origin: originA } })
    clients.push(siteA)
    siteB = await request.newContext({ baseURL: originB, extraHTTPHeaders: { origin: originB } })
    clients.push(siteB)
  })

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.dispose()))
    await Promise.all(servers.map((server) => server.release()))
    await backend?.release()
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  it('signs in on both sites and rejects forged and unlisted origins', async () => {
    const signup = await siteB.post('/api/auth/sign-up/email', {
      data: { email, name: 'Multi origin user', password },
    })
    process.stdout.write(`site B sign-up: ${signup.status()}\n`)
    expect(signup.status()).toBe(200)
    expect(await signup.json()).toMatchObject({ user: { email, name: 'Multi origin user' } })

    const signinB = await siteB.post('/api/auth/sign-in/email', { data: { email, password } })
    process.stdout.write(`site B sign-in: ${signinB.status()}\n`)
    expect(signinB.status()).toBe(200)
    expect(await signinB.json()).toMatchObject({ user: { email, name: 'Multi origin user' } })
    const sessionB = await siteB.get('/api/auth/get-session')
    process.stdout.write(`site B session: ${sessionB.status()}\n`)
    expect(sessionB.status()).toBe(200)
    expect(await sessionB.json()).toMatchObject({ user: { email, name: 'Multi origin user' } })

    const anonymousA = await siteA.get('/api/auth/get-session')
    expect(anonymousA.status()).toBe(200)
    expect(await anonymousA.json()).toBeNull()
    const signinA = await siteA.post('/api/auth/sign-in/email', { data: { email, password } })
    process.stdout.write(`site A sign-in: ${signinA.status()}\n`)
    expect(signinA.status()).toBe(200)
    expect(await signinA.json()).toMatchObject({ user: { email, name: 'Multi origin user' } })
    const sessionA = await siteA.get('/api/auth/get-session')
    expect(sessionA.status()).toBe(200)
    expect(await sessionA.json()).toMatchObject({ user: { email, name: 'Multi origin user' } })

    for (const [label, signingSecret, code] of [
      [
        'wrong signature',
        'wrong-proxy-secret-with-at-least-32-bytes',
        'AUTH_REQUEST_METADATA_INVALID',
      ],
      ['signed unlisted origin', secret, 'AUTH_CONFIG_INVALID'],
    ] as const) {
      const origin = 'http://attacker.example.test'
      const response = await fetch(`${backend!.siteUrl}/api/auth/get-session`, {
        headers: {
          'x-bcn-public-origin': origin,
          'x-bcn-public-origin-signature': createHmac('sha256', signingSecret)
            .update(`origin-v1\n${origin}`)
            .digest('base64url'),
        },
        signal: AbortSignal.timeout(30_000),
      })
      const body: unknown = await response.json()
      process.stdout.write(`${label}: ${response.status} ${JSON.stringify(body)}\n`)
      expect({ status: response.status, body }).toEqual({ status: 500, body: { code } })
    }
  })
})
