import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureLocalConvex } from '../helpers/local-convex'

const forbiddenLocalFileCredentials = [
  'CONVEX_DEPLOY_KEY',
  'CONVEX_DEPLOYMENT_TOKEN',
  'CONVEX_OVERRIDE_ACCESS_TOKEN',
  'CONVEX_PROVISION_HOST',
  'CONVEX_SELF_HOSTED_ADMIN_KEY',
  'CONVEX_SELF_HOSTED_URL',
] as const

const dotenvCredentialForms = [
  (name: string, value: string) => `${name}=${value}`,
  (name: string, value: string) => `export ${name}=${value}`,
  (name: string, value: string) => `${name}: ${value}`,
]

describe('local Convex deployment environment options', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('assigns disposable loopback ports when no saved deployment exists', async () => {
    const source = await readFile(new URL('../helpers/local-convex.ts', import.meta.url), 'utf8')
    expect(source).toContain("server.listen(0, '127.0.0.1'")
    expect(source).toContain("'--local-cloud-port'")
    expect(source).toContain("'--local-site-port'")
  })

  it.each([
    ['a record', []],
    ['valid names', { lowercase: 'value' }],
    ['reserved Convex CLI names', { CONVEX_FUTURE_AUTHORITY: 'value' }],
    ['harness-owned values', { SITE_URL: 'https://example.test' }],
    [
      'at most 16 entries',
      Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`E_${i}`, 'x'])),
    ],
    ['string values', { TEST_VALUE: 42 }],
    ['non-empty values', { TEST_VALUE: '' }],
    ['bounded values', { TEST_VALUE: 'x'.repeat(4097) }],
    ['NUL-free values', { TEST_VALUE: 'secret\0suffix' }],
  ] as const)('requires deploymentEnv to contain %s', async (_label, deploymentEnv) => {
    await expect(
      ensureLocalConvex({
        deploymentEnv: deploymentEnv as unknown as Readonly<Record<string, string>>,
      }),
    ).rejects.toThrow(/deploymentEnv|deployment environment/iu)
  })

  it('does not disclose rejected deployment environment values', async () => {
    const rejectedValue = `do-not-disclose-${'x'.repeat(4097)}`

    await expect(
      ensureLocalConvex({ deploymentEnv: { TEST_SECRET: rejectedValue } }),
    ).rejects.not.toThrow(rejectedValue)
  })

  it.each(
    forbiddenLocalFileCredentials.flatMap((name) =>
      dotenvCredentialForms.map((format) => [name, format] as const),
    ),
  )('rejects dotenv cloud credential %s before auto-starting', async (name, format) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'bcn-local-convex-'))
    const credential = 'do-not-use-or-disclose-this-cloud-key'
    await writeFile(
      path.join(cwd, '.env.local'),
      [
        'CONVEX_DEPLOYMENT=anonymous:local-test',
        'CONVEX_URL=http://127.0.0.1:3210',
        'CONVEX_SITE_URL=http://127.0.0.1:3211',
        format(name, credential),
      ].join('\n'),
      'utf8',
    )
    vi.stubEnv('CONVEX_E2E_AUTO_START', 'true')

    try {
      const error = await ensureLocalConvex({ cwd }).then(
        () => null,
        (cause: unknown) => cause,
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(
        `remove forbidden deployment credential(s): ${name}`,
      )
      expect((error as Error).message).not.toContain(credential)
    } finally {
      await rm(cwd, { force: true, recursive: true })
    }
  })
})
