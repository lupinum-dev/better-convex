import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runInitCommand, type InitDependencies } from '../../src/runtime/cli/init'

interface Harness {
  confirmations: string[]
  convexCalls: Array<{ args: readonly string[]; input?: string }>
  environment: Map<string, string>
  logs: string[]
  dependencies: InitDependencies
}

function createHarness(confirmations: boolean[] = [true, true, true]): Harness {
  const environment = new Map<string, string>()
  const logs: string[] = []
  const convexCalls: Array<{ args: readonly string[]; input?: string }> = []
  const confirmationMessages: string[] = []
  const answers = [...confirmations]
  const dependencies: InitDependencies = {
    async confirm(message) {
      confirmationMessages.push(message)
      return answers.shift() ?? false
    },
    async prompt() {
      return 'http://localhost:4173'
    },
    async readDevelopmentAuthorityLabel() {
      return 'dev:fixture'
    },
    async runConvex(args, input) {
      convexCalls.push({ args, input })
      if (args[0] === 'env' && args[1] === 'set') {
        environment.set(args[2]!, input ?? '')
        return 0
      }
      return 0
    },
    async readEnvironmentNames() {
      return new Set(environment.keys())
    },
    async generateSchema(args) {
      const output = args[args.indexOf('--output') + 1]!
      if (args.includes('--check')) return 0
      await mkdir(output, { recursive: true })
      await writeFile(join(output, 'schema.ts'), 'generated schema\n')
      await writeFile(join(output, 'schemaMetadata.ts'), 'generated metadata\n')
      return 0
    },
    randomSecret: () => 'SENTINEL_SECRET_DO_NOT_LOG',
    log(message) {
      logs.push(message)
    },
  }
  return {
    confirmations: confirmationMessages,
    convexCalls,
    environment,
    logs,
    dependencies,
  }
}

describe.sequential('better-convex init', () => {
  let root: string
  let previousCwd: string

  beforeEach(async () => {
    previousCwd = process.cwd()
    root = await mkdtemp(join(tmpdir(), 'better-convex-init-'))
    process.chdir(root)
  })

  afterEach(async () => {
    process.chdir(previousCwd)
    await rm(root, { recursive: true, force: true })
  })

  const read = (file: string) => readFile(join(root, file), 'utf8')
  const expectMissing = (file: string) =>
    expect(read(file)).rejects.toMatchObject({ code: 'ENOENT' })

  it('creates the reviewed files and provisions development without logging secrets', async () => {
    const harness = createHarness()

    await expect(runInitCommand(['--typed-client'], harness.dependencies)).resolves.toBe(0)

    expect(await read('convex/auth.ts')).toContain('createBetterConvexAuth')
    expect(await read('app/convex-auth.ts')).toContain('defineConvexAuthClient')
    expect(await read('convex/betterAuth/schema.ts')).toBe('generated schema\n')
    expect(harness.environment.get('SITE_URL')).toBe('http://localhost:4173')
    expect(harness.environment.has('BCN_AUTH_INITIALIZED')).toBe(false)
    expect(harness.convexCalls.some(({ args }) => args[1] === 'auth:ensureSigningKey')).toBe(true)
    expect(JSON.stringify(harness.logs)).not.toContain('SENTINEL_SECRET_DO_NOT_LOG')
    expect(JSON.stringify(harness.convexCalls.map(({ args }) => args))).not.toContain(
      'SENTINEL_SECRET_DO_NOT_LOG',
    )
    expect(harness.confirmations.at(-1)).toContain('dev:fixture')
  })

  it('E04 provisions missing secrets and signing keys despite an old init marker', async () => {
    const harness = createHarness()
    harness.environment.set('BCN_AUTH_INITIALIZED', '1')
    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)
    expect(harness.environment.get('SITE_URL')).toBe('http://localhost:4173')
    expect(harness.environment.get('BETTER_AUTH_SECRETS')).toBe('0:SENTINEL_SECRET_DO_NOT_LOG')
    expect(harness.environment.get('BCN_AUTH_PROXY_IP_SECRET')).toBe('SENTINEL_SECRET_DO_NOT_LOG')
    expect(
      harness.convexCalls.filter(({ args }) => args[1] === 'auth:ensureSigningKey'),
    ).toHaveLength(1)
    expect(harness.logs.join(' ')).not.toContain('already provisioned')
  })

  it('writes the same site URL and proxy secret to .env.local and Convex', async () => {
    const harness = createHarness()
    await writeFile(join(root, '.env.local'), 'CONVEX_URL=https://fixture.convex.cloud')

    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)

    expect(await read('.env.local')).toBe(
      'CONVEX_URL=https://fixture.convex.cloud\nSITE_URL=http://localhost:4173\nBCN_AUTH_PROXY_IP_SECRET=SENTINEL_SECRET_DO_NOT_LOG\n',
    )
    expect(harness.environment.get('BCN_AUTH_PROXY_IP_SECRET')).toBe('SENTINEL_SECRET_DO_NOT_LOG')
    expect(JSON.stringify(harness.logs)).not.toContain('SENTINEL_SECRET_DO_NOT_LOG')
  })

  it('reuses the proxy secret already in .env.local', async () => {
    const harness = createHarness()
    const local =
      'SITE_URL=http://localhost:4173\nBCN_AUTH_PROXY_IP_SECRET="existing-local-secret"\n'
    await writeFile(join(root, '.env.local'), local)

    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)

    expect(await read('.env.local')).toBe(local)
    expect(harness.environment.get('BCN_AUTH_PROXY_IP_SECRET')).toBe('existing-local-secret')
  })

  it.each([
    'SITE_URL=http://localhost:4173 # local app\n',
    'SITE_URL=http://localhost:4173# local app\n',
    'SITE_URL="http://localhost:4173" # local app\n',
  ])('reads an existing .env.local value like dotenv: %s', async (local) => {
    const harness = createHarness()
    await writeFile(join(root, '.env.local'), local)

    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)

    expect(harness.environment.get('SITE_URL')).toBe('http://localhost:4173')
  })

  it('provisions the last SITE_URL assignment like the app environment loader', async () => {
    const harness = createHarness()
    await writeFile(
      join(root, '.env.local'),
      'SITE_URL=http://localhost:3000\nSITE_URL=http://localhost:4173\n',
    )
    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)
    expect(harness.environment.get('SITE_URL')).toBe('http://localhost:4173')
  })

  it('keeps .env.local unchanged and says what to add when Convex already has SITE_URL', async () => {
    const harness = createHarness()
    harness.environment.set('SITE_URL', 'http://localhost:5000')

    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)

    expect(await read('.env.local')).not.toContain('SITE_URL=')
    expect(harness.logs.join('\n')).toContain('SITE_URL is set in Convex but not in .env.local')
  })

  it('keeps an interpolated .env.local SITE_URL and reminds that it must match', async () => {
    const harness = createHarness()
    const local = 'SITE_URL=http://localhost:${PORT}\n'
    await writeFile(join(root, '.env.local'), local)

    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)

    expect(await read('.env.local')).toContain(local)
    expect(harness.environment.get('SITE_URL')).toBe('http://localhost:4173')
    expect(harness.logs.join('\n')).toContain('It must resolve to http://localhost:4173')
  })

  it('stops before provisioning when the entered site URL differs from .env.local', async () => {
    const harness = createHarness()
    await writeFile(join(root, '.env.local'), 'SITE_URL=http://localhost:3000\n')

    await expect(runInitCommand([], harness.dependencies)).rejects.toThrow(
      'SITE_URL=http://localhost:3000',
    )

    expect(harness.environment.has('SITE_URL')).toBe(false)
    expect(await read('.env.local')).toBe('SITE_URL=http://localhost:3000\n')
  })

  it('writes nothing when the file plan is cancelled', async () => {
    const harness = createHarness([false])

    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)

    await expectMissing('convex/auth.ts')
    expect(harness.convexCalls).toHaveLength(0)
  })

  it('does not provision when schema generation is cancelled separately', async () => {
    const harness = createHarness([true, false])

    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)

    expect(await read('convex/auth.ts')).toContain('createBetterConvexAuth')
    await expectMissing('convex/betterAuth/schema.ts')
    expect(harness.convexCalls).toHaveLength(0)
  })

  it.each(['schema.ts', 'schemaMetadata.ts'])(
    'writes nothing when only generated %s exists',
    async (generatedFile) => {
      const harness = createHarness()
      await mkdir(join(root, 'convex/betterAuth'), { recursive: true })
      await writeFile(join(root, 'convex/betterAuth', generatedFile), 'incomplete schema\n')

      await expect(runInitCommand([], harness.dependencies)).rejects.toThrow(
        'incomplete generated auth schema',
      )

      await expectMissing('convex/auth.ts')
      expect(harness.convexCalls).toHaveLength(0)
    },
  )

  it('does not change external state when environment inspection fails', async () => {
    const harness = createHarness()
    harness.dependencies.readEnvironmentNames = async () => {
      throw new Error('Could not inspect the development Convex environment; no values changed.')
    }

    await expect(runInitCommand([], harness.dependencies)).rejects.toThrow('no values changed')

    expect(harness.environment.size).toBe(0)
    expect(harness.convexCalls).toHaveLength(0)
  })

  it('reruns without rewriting files or secrets and rechecks the signing key', async () => {
    const harness = createHarness()
    await runInitCommand([], harness.dependencies)
    const authBefore = await read('convex/auth.ts')
    const envBefore = await read('.env.local')
    const completedCalls = harness.convexCalls.length
    harness.confirmations.length = 0
    const rerun = { ...harness.dependencies, confirm: async () => true }

    await expect(runInitCommand([], rerun)).resolves.toBe(0)

    expect(await read('convex/auth.ts')).toBe(authBefore)
    expect(await read('.env.local')).toBe(envBefore)
    expect(harness.convexCalls.slice(completedCalls)).toEqual([
      { args: ['run', 'auth:ensureSigningKey', '{}'], input: undefined },
    ])
    expect(harness.logs.at(-1)).toBe('Development provisioning complete: signing key.')
  })

  it('stops before all writes when an existing setup conflicts', async () => {
    await mkdir(join(root, 'convex'), { recursive: true })
    await writeFile(join(root, 'convex/auth.ts'), 'application-owned auth\n')
    const harness = createHarness()

    await expect(runInitCommand([], harness.dependencies)).rejects.toThrow('convex/auth.ts')

    await expectMissing('convex/http.ts')
    expect(harness.convexCalls).toHaveLength(0)
  })

  it('reports partial external completion and safely continues on rerun', async () => {
    const harness = createHarness()
    let failProxySecret = true
    const runConvex = harness.dependencies.runConvex
    harness.dependencies.runConvex = async (args, input) => {
      if (args[0] === 'env' && args[1] === 'set' && args[2] === 'BCN_AUTH_PROXY_IP_SECRET') {
        if (failProxySecret) {
          failProxySecret = false
          return 1
        }
      }
      return await runConvex(args, input)
    }

    await expect(runInitCommand([], harness.dependencies)).rejects.toThrow(
      'SITE_URL, BETTER_AUTH_SECRETS',
    )
    expect(harness.environment.get('BETTER_AUTH_SECRETS')).toBe('0:SENTINEL_SECRET_DO_NOT_LOG')

    await expect(
      runInitCommand([], { ...harness.dependencies, confirm: async () => true }),
    ).resolves.toBe(0)
    expect(harness.environment.has('BCN_AUTH_INITIALIZED')).toBe(false)
    expect(JSON.stringify(harness.logs)).not.toContain('SENTINEL_SECRET_DO_NOT_LOG')
  })

  it('runs without questions with --yes and takes the site URL from --site-url', async () => {
    const harness = createHarness([])
    const { confirm: _confirm, prompt: _prompt, ...scripted } = harness.dependencies

    await expect(
      runInitCommand(['--yes', '--site-url', 'https://preview.example.test'], scripted),
    ).resolves.toBe(0)

    expect(await readFile(join(root, 'convex/auth.ts'), 'utf8')).toContain('createBetterConvexAuth')
    expect(harness.environment.get('SITE_URL')).toBe('https://preview.example.test')
    expect(harness.confirmations).toEqual([])
  })

  it('uses the default site URL with --yes alone', async () => {
    const harness = createHarness([])
    const { confirm: _confirm, prompt: _prompt, ...scripted } = harness.dependencies

    await expect(runInitCommand(['-y'], scripted)).resolves.toBe(0)

    expect(harness.environment.get('SITE_URL')).toBe('http://localhost:3000')
  })

  it.each([['--site-url'], ['--site-url=https://app.example.test/path'], ['--site-url=nope']])(
    'rejects an invalid --site-url before any change: %s',
    async (...args) => {
      const harness = createHarness()
      await expect(runInitCommand(args, harness.dependencies)).rejects.toThrow()
      expect(harness.convexCalls).toHaveLength(0)
    },
  )

  it('refuses production provisioning flags', async () => {
    await expect(runInitCommand(['--prod'], createHarness().dependencies)).rejects.toThrow(
      'refuses production',
    )
  })

  it('refuses production authority before starting a provisioning command', async () => {
    await mkdir(join(root, 'node_modules/convex/bin'), { recursive: true })
    await writeFile(
      join(root, '.env.local'),
      'CONVEX_DEPLOY_KEY=prod:fixture-production|not-a-real-credential\n',
      { mode: 0o600 },
    )
    await writeFile(
      join(root, 'node_modules/convex/bin/main.js'),
      "require('node:fs').writeFileSync('production-command-started', 'unsafe')\n",
    )

    await expect(
      runInitCommand([], {
        confirm: async () => true,
        generateSchema: async () => 0,
        log: () => undefined,
        prompt: async (_message, defaultValue) => defaultValue,
        randomSecret: () => 'fixture-generated-secret-never-real',
      }),
    ).rejects.toThrow('refuses production or unclassified authority')
    await expectMissing('production-command-started')
  })
})
