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

  it('creates the reviewed files and provisions development without logging secrets', async () => {
    const harness = createHarness()

    await expect(runInitCommand(['--typed-client'], harness.dependencies)).resolves.toBe(0)

    expect(await readFile(join(root, 'convex/auth.ts'), 'utf8')).toContain('createBetterConvexAuth')
    expect(await readFile(join(root, 'convex-auth.ts'), 'utf8')).toContain('defineConvexAuthClient')
    expect(await readFile(join(root, 'convex/betterAuth/schema.ts'), 'utf8')).toBe(
      'generated schema\n',
    )
    expect(harness.environment.get('SITE_URL')).toBe('http://localhost:4173')
    expect(harness.environment.get('BCN_AUTH_INITIALIZED')).toBe('1')
    expect(harness.convexCalls.some(({ args }) => args[1] === 'auth:ensureSigningKey')).toBe(true)
    expect(JSON.stringify(harness.logs)).not.toContain('SENTINEL_SECRET_DO_NOT_LOG')
    expect(JSON.stringify(harness.convexCalls.map(({ args }) => args))).not.toContain(
      'SENTINEL_SECRET_DO_NOT_LOG',
    )
  })

  it('writes nothing when the file plan is cancelled', async () => {
    const harness = createHarness([false])

    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)

    await expect(readFile(join(root, 'convex/auth.ts'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(harness.convexCalls).toHaveLength(0)
  })

  it('does not provision when schema generation is cancelled separately', async () => {
    const harness = createHarness([true, false])

    await expect(runInitCommand([], harness.dependencies)).resolves.toBe(0)

    expect(await readFile(join(root, 'convex/auth.ts'), 'utf8')).toContain('createBetterConvexAuth')
    await expect(readFile(join(root, 'convex/betterAuth/schema.ts'), 'utf8')).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
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

      await expect(readFile(join(root, 'convex/auth.ts'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      })
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

  it('reruns without rewriting files or reprovisioning completed external state', async () => {
    const harness = createHarness()
    await runInitCommand([], harness.dependencies)
    const authBefore = await readFile(join(root, 'convex/auth.ts'), 'utf8')
    harness.confirmations.length = 0
    const rerun = { ...harness.dependencies, confirm: async () => true }

    await expect(runInitCommand([], rerun)).resolves.toBe(0)

    expect(await readFile(join(root, 'convex/auth.ts'), 'utf8')).toBe(authBefore)
    expect(harness.logs.at(-1)).toContain('already provisioned')
  })

  it('stops before all writes when an existing setup conflicts', async () => {
    await mkdir(join(root, 'convex'), { recursive: true })
    await writeFile(join(root, 'convex/auth.ts'), 'application-owned auth\n')
    const harness = createHarness()

    await expect(runInitCommand([], harness.dependencies)).rejects.toThrow('convex/auth.ts')

    await expect(readFile(join(root, 'convex/http.ts'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
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
    expect(harness.environment.get('BCN_AUTH_INITIALIZED')).toBe('1')
    expect(JSON.stringify(harness.logs)).not.toContain('SENTINEL_SECRET_DO_NOT_LOG')
  })

  it('refuses production provisioning flags', async () => {
    await expect(runInitCommand(['--prod'], createHarness().dependencies)).rejects.toThrow(
      'refuses production',
    )
  })
})
