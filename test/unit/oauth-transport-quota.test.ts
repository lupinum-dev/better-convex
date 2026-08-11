import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  AUTH_CONTENTION_MAX_RETRIES,
  authContentionRetryDelayMs,
  safeAuthConcurrencyFailure,
  shouldRetryAuthContention,
} from '../../scripts/run-auth-concurrency.mjs'
import {
  DISABLED_OAUTH_ROUTE_PROBES,
  OAUTH_TRANSPORT_QUOTA_PROFILES,
  buildOAuthQuotaRequest,
  safeQuotaEvidenceFailureCode,
  summarizeQuotaBoundary,
  validateQuotaWorkerRequest,
} from '../../scripts/run-oauth-transport-quota.mjs'

const root = resolve(import.meta.dirname, '../..')
const origin = 'http://127.0.0.1:3050'
const signedHeaders = {
  'x-bcn-client-ip': '192.0.2.10',
  'x-bcn-client-ip-signature': 'A'.repeat(43),
}

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

interface Workflow {
  jobs?: Record<string, { steps?: Array<{ run?: unknown }> }>
}

function workflowRuns(path: string, jobId: string): string[] {
  const workflow = parse(read(path)) as Workflow
  return (workflow.jobs?.[jobId]?.steps ?? [])
    .map((step) => (typeof step.run === 'string' ? step.run.replace(/\s+/gu, ' ').trim() : null))
    .filter((run): run is string => run !== null)
}

describe('real OAuth transport quota evidence', () => {
  it('pins the provider limits, windows, guard statuses, and disabled route inventory', () => {
    expect(OAUTH_TRANSPORT_QUOTA_PROFILES).toEqual({
      authorize: {
        guardStatus: 400,
        limit: 30,
        method: 'GET',
        name: 'authorize',
        path: '/api/auth/oauth2/authorize',
        windowSeconds: 60,
      },
      revoke: {
        guardStatus: 401,
        limit: 30,
        method: 'POST',
        name: 'revoke',
        path: '/api/auth/oauth2/revoke',
        windowSeconds: 60,
      },
      token: {
        guardStatus: 401,
        limit: 20,
        method: 'POST',
        name: 'token',
        path: '/api/auth/oauth2/token',
        windowSeconds: 60,
      },
    })
    expect(DISABLED_OAUTH_ROUTE_PROBES).toHaveLength(8)
    expect(DISABLED_OAUTH_ROUTE_PROBES.map(({ path }) => path)).toEqual([
      '/api/auth/token',
      '/api/auth/get-access-token',
      '/api/auth/refresh-token',
      '/api/auth/.well-known/openid-configuration',
      '/api/auth/oauth2/register',
      '/api/auth/oauth2/introspect',
      '/api/auth/oauth2/userinfo',
      '/api/auth/oauth2/end-session',
    ])
  })

  it('uses duplicate and mixed-client-auth guard failures as quota traffic', () => {
    const authorize = buildOAuthQuotaRequest('authorize', origin, origin, signedHeaders)
    const authorizeParameters = new URL(authorize.url).searchParams
    expect(authorizeParameters.getAll('resource')).toHaveLength(2)
    expect(authorizeParameters.get('redirect_uri')).toContain('#fragment-not-allowed')
    expect(() => validateQuotaWorkerRequest(authorize)).not.toThrow()

    for (const profileName of ['token', 'revoke'] as const) {
      const request = buildOAuthQuotaRequest(profileName, origin, origin, signedHeaders)
      if (!('body' in request)) throw new Error('Expected a POST quota request')
      const parameters = new URLSearchParams(request.body)
      expect(parameters.getAll('client_id')).toEqual(['lookup-must-not-run'])
      expect(Reflect.get(request.headers, 'authorization')).toMatch(/^Basic /u)
      expect(() => validateQuotaWorkerRequest(request)).not.toThrow()
    }
  })

  it('fails closed on unsafe child-process request input', () => {
    const valid = buildOAuthQuotaRequest('token', origin, origin, signedHeaders)
    expect(() => validateQuotaWorkerRequest(valid)).not.toThrow()
    expect(() =>
      validateQuotaWorkerRequest({
        ...valid,
        url: 'https://attacker.example/api/auth/oauth2/token',
      }),
    ).toThrow('OAUTH_QUOTA_WORKER_INPUT_INVALID')
    expect(() =>
      validateQuotaWorkerRequest({
        ...valid,
        headers: { ...valid.headers, 'x-forwarded-for': '192.0.2.10' },
      }),
    ).toThrow('OAUTH_QUOTA_WORKER_INPUT_INVALID')
    expect(() =>
      validateQuotaWorkerRequest({
        ...valid,
        headers: { ...valid.headers, 'x-bcn-client-ip-signature': undefined },
      }),
    ).toThrow('OAUTH_QUOTA_WORKER_INPUT_INVALID')
  })

  it('reports only bounded fixture and worker failure classes', () => {
    expect(
      safeQuotaEvidenceFailureCode(
        new Error('Timed out waiting for MCP OAuth Convex function deployment: secret output'),
      ),
    ).toBe('OAUTH_QUOTA_FIXTURE_DEPLOY_TIMEOUT')
    expect(
      safeQuotaEvidenceFailureCode(
        new Error('Timed out waiting for Nuxt MCP OAuth fixture: secret output'),
      ),
    ).toBe('OAUTH_QUOTA_FIXTURE_NUXT_TIMEOUT')
    expect(safeQuotaEvidenceFailureCode(new Error('OAUTH_QUOTA_WORKER_SPAWN_EAGAIN'))).toBe(
      'OAUTH_QUOTA_WORKER_SPAWN_EAGAIN',
    )
    expect(safeQuotaEvidenceFailureCode(new Error('secret output'))).toBe(
      'OAUTH_QUOTA_FIXTURE_FAILED',
    )
  })

  it('accepts exactly one remaining boundary request and returns counts only', () => {
    expect(
      summarizeQuotaBoundary('token', [
        { retryAfter: null, status: 401 },
        { retryAfter: 60, status: 429 },
      ]),
    ).toEqual({ admitted: 1, childProcesses: 2, throttled: 1 })
    expect(() =>
      summarizeQuotaBoundary('authorize', [
        { retryAfter: null, status: 400 },
        { retryAfter: null, status: 400 },
      ]),
    ).toThrow('OAUTH_QUOTA_BOUNDARY_EXCEEDED')
  })

  it('composes the live runner and schedules it only after backend/browser setup', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>
    }
    expect(packageJson.scripts['test:auth-concurrency']?.split(' && ')).toEqual([
      'node scripts/run-auth-concurrency.mjs',
      'node scripts/run-oauth-transport-quota.mjs',
      'node scripts/run-oauth-code-concurrency.mjs',
    ])

    const workflowJobs = [
      {
        jobId: 'auth-contracts',
        path: '.github/workflows/ci.yml',
        run: 'pnpm release:certify:source auth',
      },
      {
        jobId: 'pinned-backend',
        path: '.github/workflows/security-extended.yml',
        run: 'pnpm test:auth-concurrency',
      },
    ]
    for (const job of workflowJobs) {
      const commands = workflowRuns(job.path, job.jobId)
      const backend = commands.indexOf('pnpm check:auth-backend --install')
      const browser = commands.indexOf('pnpm exec playwright install --with-deps chromium')
      const evidence = commands.findIndex((command) => command.startsWith(job.run))
      expect(backend).toBeGreaterThan(-1)
      expect(browser).toBeGreaterThan(-1)
      expect(evidence).toBeGreaterThan(browser)
    }
  })

  it('retries only explicit increment contention with a bounded deterministic backoff', () => {
    expect(
      safeAuthConcurrencyFailure(
        new Error(
          'Documents read from or written to the table changed while this mutation was being run and on every subsequent retry.',
        ),
      ),
    ).toBe('CONVEX_CONTENTION')
    expect(safeAuthConcurrencyFailure(new Error('Network timeout; retry later.'))).toBe(
      'UNEXPECTED_MUTATION_FAILURE',
    )
    expect(safeAuthConcurrencyFailure(new Error('Upstream contention warning.'))).toBe(
      'UNEXPECTED_MUTATION_FAILURE',
    )
    expect(shouldRetryAuthContention('increment', 'CONVEX_CONTENTION', 0)).toBe(true)
    expect(shouldRetryAuthContention('componentIncrement', 'CONVEX_CONTENTION', 0)).toBe(true)
    expect(
      shouldRetryAuthContention('increment', 'CONVEX_CONTENTION', AUTH_CONTENTION_MAX_RETRIES),
    ).toBe(false)
    expect(shouldRetryAuthContention('increment', 'UNEXPECTED_MUTATION_FAILURE', 0)).toBe(false)
    expect(shouldRetryAuthContention('consume', 'CONVEX_CONTENTION', 0)).toBe(false)
    expect(shouldRetryAuthContention('operatorRotate', 'CONVEX_CONTENTION', 0)).toBe(false)

    const delays = Array.from({ length: AUTH_CONTENTION_MAX_RETRIES }, (_, attempt) =>
      authContentionRetryDelayMs(attempt, 2, 3),
    )
    expect(delays).toEqual([...delays].sort((left, right) => left - right))
    expect(authContentionRetryDelayMs(0, 2, 3)).toBe(delays[0])
    expect(authContentionRetryDelayMs(0, 3, 3)).not.toBe(delays[0])
    expect(() => authContentionRetryDelayMs(-1, 0, 0)).toThrow(
      'AUTH_CONTENTION_RETRY_INPUT_INVALID',
    )
  })

  it('preserves exact safe uniqueness evidence from the real-backend races', () => {
    expect(
      safeAuthConcurrencyFailure(
        new Error('server error: AUTH_UNIQUE_CONFLICT:account.issuer_providerAccountId'),
      ),
    ).toBe('AUTH_UNIQUE_CONFLICT:account.issuer_providerAccountId')
  })
})
