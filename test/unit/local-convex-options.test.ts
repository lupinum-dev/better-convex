import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ensureLocalConvex,
  readLocalConvexEnv,
  resolveLocalConvexCli,
} from '../helpers/local-convex'

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

  it('resolves the consumer CLI instead of the library CLI without executing it', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'bcn-local-convex-cli-'))
    const packageDirectory = path.join(cwd, 'node_modules/convex')
    try {
      await mkdir(packageDirectory, { recursive: true })
      await writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({ name: 'synthetic-consumer', private: true }),
        'utf8',
      )
      await writeFile(
        path.join(packageDirectory, 'package.json'),
        JSON.stringify({
          name: 'convex',
          version: '1.43.0',
          exports: { './package.json': './package.json' },
        }),
        'utf8',
      )
      expect(resolveLocalConvexCli(cwd)).toBe(
        path.join(await realpath(packageDirectory), 'bin/main.js'),
      )
    } finally {
      await rm(cwd, { force: true, recursive: true })
    }
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
    ['harness-owned Vite cloud URL', { VITE_CONVEX_URL: 'http://127.0.0.1:3210' }],
    ['harness-owned Vite site URL', { VITE_CONVEX_SITE_URL: 'http://127.0.0.1:3211' }],
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

  it.each(['vite', 'canonical', 'matching-both'])(
    'reads %s CLI URL assignments without starting a backend',
    async (format) => {
      const cwd = await mkdtemp(path.join(tmpdir(), 'bcn-local-convex-alias-'))
      const values = ['CONVEX_DEPLOYMENT=anonymous:alias-test']
      if (format !== 'vite')
        values.push('CONVEX_URL=http://127.0.0.1:3210', 'CONVEX_SITE_URL=http://127.0.0.1:3211')
      if (format !== 'canonical')
        values.push(
          'VITE_CONVEX_URL=http://127.0.0.1:3210',
          'VITE_CONVEX_SITE_URL=http://127.0.0.1:3211',
        )
      try {
        await writeFile(path.join(cwd, '.env.local'), values.join('\n'), 'utf8')
        expect(await readLocalConvexEnv(cwd)).toEqual({
          deployment: 'anonymous:alias-test',
          forbiddenCredentialNames: [],
          url: 'http://127.0.0.1:3210',
          siteUrl: 'http://127.0.0.1:3211',
        })
      } finally {
        await rm(cwd, { force: true, recursive: true })
      }
    },
  )

  it.each(['CONVEX_URL', 'CONVEX_SITE_URL'])(
    'rejects conflicting %s aliases without echoing values',
    async (name) => {
      const cwd = await mkdtemp(path.join(tmpdir(), 'bcn-local-convex-conflict-'))
      const secret = 'synthetic-not-for-errors'
      try {
        await writeFile(
          path.join(cwd, '.env.local'),
          `${name}=http://127.0.0.1:3210\nVITE_${name}=https://${secret}@remote.example.test`,
          'utf8',
        )
        await expect(readLocalConvexEnv(cwd)).rejects.toThrow(
          `Conflicting local Convex URL aliases: ${name} and VITE_${name}.`,
        )
        await expect(readLocalConvexEnv(cwd)).rejects.not.toThrow(secret)
        vi.stubEnv('CONVEX_E2E_AUTO_START', 'true')
        await expect(ensureLocalConvex({ cwd })).rejects.toThrow(
          'Conflicting local Convex URL aliases',
        )
      } finally {
        await rm(cwd, { force: true, recursive: true })
      }
    },
  )

  it.each([
    'https://remote.example.test',
    'http://127.0.0.1.example.test:3210',
    'http://localhost.example.test:3210',
    'http://user:synthetic-password@127.0.0.1:3210',
    'http://127.0.0.1:3210/path',
    'http://127.0.0.1:3210/?token=synthetic',
    '"http://127.0.0.1:3210/#fragment"',
    'https://127.0.0.1:3210',
    'http://127.0.0.1',
  ])('refuses unsafe Vite alias selection %s before starting a process', async (url) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'bcn-local-convex-unsafe-'))
    vi.stubEnv('CONVEX_E2E_AUTO_START', 'true')
    try {
      await writeFile(
        path.join(cwd, '.env.local'),
        `CONVEX_DEPLOYMENT=anonymous:alias-test\nVITE_CONVEX_URL=${url}\nVITE_CONVEX_SITE_URL=http://127.0.0.1:3211`,
        'utf8',
      )
      await expect(ensureLocalConvex({ cwd })).rejects.toThrow(
        'Refusing non-local Convex selection',
      )
    } finally {
      await rm(cwd, { force: true, recursive: true })
    }
  })

  it('retains credential rejection when the CLI uses Vite aliases', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'bcn-local-convex-credential-alias-'))
    vi.stubEnv('CONVEX_E2E_AUTO_START', 'true')
    try {
      await writeFile(
        path.join(cwd, '.env.local'),
        'CONVEX_DEPLOYMENT=anonymous:alias-test\nVITE_CONVEX_URL=http://127.0.0.1:3210\nVITE_CONVEX_SITE_URL=http://127.0.0.1:3211\nCONVEX_DEPLOY_KEY=synthetic-credential',
        'utf8',
      )
      await expect(ensureLocalConvex({ cwd })).rejects.toThrow(
        'remove forbidden deployment credential(s): CONVEX_DEPLOY_KEY',
      )
    } finally {
      await rm(cwd, { force: true, recursive: true })
    }
  })
})
