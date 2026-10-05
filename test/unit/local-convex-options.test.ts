import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ensureLocalConvex,
  readLocalConvexEnv,
  resolveLocalConvexCli,
  spawnConvex,
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

/** Runs `check` in a temporary directory whose `.env.local` holds `envLocal`. */
async function withEnvLocal(envLocal: string, check: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'bcn-local-convex-'))
  try {
    await writeFile(path.join(cwd, '.env.local'), envLocal, 'utf8')
    await check(cwd)
  } finally {
    await rm(cwd, { force: true, recursive: true })
  }
}

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

  it('blocks inherited cloud credentials in the local subprocess environment', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'bcn-local-convex-env-'))
    try {
      const cliDirectory = path.join(cwd, 'node_modules/convex/bin')
      await mkdir(cliDirectory, { recursive: true })
      await writeFile(path.join(cwd, 'package.json'), '{"private":true}')
      await writeFile(
        path.join(cliDirectory, '../package.json'),
        '{"name":"convex","exports":{"./package.json":"./package.json"}}',
      )
      // A real subprocess reports only synthetic credential values, without a backend.
      await writeFile(
        path.join(cliDirectory, 'main.js'),
        `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(forbiddenLocalFileCredentials)}.map(name => [name, process.env[name]]))))`,
      )
      for (const name of forbiddenLocalFileCredentials) vi.stubEnv(name, 'synthetic-cloud-key')
      const child = spawnConvex(cwd, [])
      child.stdin.end()
      let output = ''
      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
      })
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', resolve)
      })
      expect(code).toBe(0)
      expect(JSON.parse(output)).toEqual({
        CONVEX_DEPLOY_KEY: '',
        CONVEX_DEPLOYMENT_TOKEN: '',
        CONVEX_OVERRIDE_ACCESS_TOKEN: '',
        CONVEX_PROVISION_HOST: '',
        CONVEX_SELF_HOSTED_ADMIN_KEY: '',
        CONVEX_SELF_HOSTED_URL: '',
      })
    } finally {
      await rm(cwd, { force: true, recursive: true })
    }
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
    const credential = 'do-not-use-or-disclose-this-cloud-key'
    vi.stubEnv('CONVEX_E2E_AUTO_START', 'true')
    const envLocal = [
      'CONVEX_DEPLOYMENT=anonymous:local-test',
      'CONVEX_URL=http://127.0.0.1:3210',
      'CONVEX_SITE_URL=http://127.0.0.1:3211',
      format(name, credential),
    ].join('\n')

    await withEnvLocal(envLocal, async (cwd) => {
      const error = await ensureLocalConvex({ cwd }).then(
        () => null,
        (cause: unknown) => cause,
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(
        `remove forbidden deployment credential(s): ${name}`,
      )
      expect((error as Error).message).not.toContain(credential)
    })
  })

  it.each(['vite', 'canonical', 'matching-both'])(
    'reads %s CLI URL assignments without starting a backend',
    async (format) => {
      const values = ['CONVEX_DEPLOYMENT=anonymous:alias-test']
      if (format !== 'vite')
        values.push('CONVEX_URL=http://127.0.0.1:3210', 'CONVEX_SITE_URL=http://127.0.0.1:3211')
      if (format !== 'canonical')
        values.push(
          'VITE_CONVEX_URL=http://127.0.0.1:3210',
          'VITE_CONVEX_SITE_URL=http://127.0.0.1:3211',
        )
      await withEnvLocal(values.join('\n'), async (cwd) => {
        expect(await readLocalConvexEnv(cwd)).toEqual({
          deployment: 'anonymous:alias-test',
          forbiddenCredentialNames: [],
          url: 'http://127.0.0.1:3210',
          siteUrl: 'http://127.0.0.1:3211',
        })
      })
    },
  )

  it.each(['CONVEX_URL', 'CONVEX_SITE_URL'])(
    'rejects conflicting %s aliases without echoing values',
    async (name) => {
      const secret = 'synthetic-not-for-errors'
      const envLocal = `${name}=http://127.0.0.1:3210\nVITE_${name}=https://${secret}@remote.example.test`
      await withEnvLocal(envLocal, async (cwd) => {
        await expect(readLocalConvexEnv(cwd)).rejects.toThrow(
          `Conflicting local Convex URL aliases: ${name} and VITE_${name}.`,
        )
        await expect(readLocalConvexEnv(cwd)).rejects.not.toThrow(secret)
        vi.stubEnv('CONVEX_E2E_AUTO_START', 'true')
        await expect(ensureLocalConvex({ cwd })).rejects.toThrow(
          'Conflicting local Convex URL aliases',
        )
      })
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
    vi.stubEnv('CONVEX_E2E_AUTO_START', 'true')
    const envLocal = `CONVEX_DEPLOYMENT=anonymous:alias-test\nVITE_CONVEX_URL=${url}\nVITE_CONVEX_SITE_URL=http://127.0.0.1:3211`
    await withEnvLocal(envLocal, async (cwd) => {
      await expect(ensureLocalConvex({ cwd })).rejects.toThrow(
        'Refusing non-local Convex selection',
      )
    })
  })

  it('retains credential rejection when the CLI uses Vite aliases', async () => {
    vi.stubEnv('CONVEX_E2E_AUTO_START', 'true')
    const envLocal =
      'CONVEX_DEPLOYMENT=anonymous:alias-test\nVITE_CONVEX_URL=http://127.0.0.1:3210\nVITE_CONVEX_SITE_URL=http://127.0.0.1:3211\nCONVEX_DEPLOY_KEY=synthetic-credential'
    await withEnvLocal(envLocal, async (cwd) => {
      await expect(ensureLocalConvex({ cwd })).rejects.toThrow(
        'remove forbidden deployment credential(s): CONVEX_DEPLOY_KEY',
      )
    })
  })
})
