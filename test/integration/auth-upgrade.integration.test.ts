// 1.0.0-beta.7 auth data upgrades to 1.0 through a normal `convex dev` push on
// the pinned backend: no export, import, or manual table clearing.
//
//   1. beta.7   push the beta.7 component schema and seed beta-shaped users,
//               accounts with `issuer`, sessions, OAuth client, resource,
//               consent, access and refresh tokens (test/fixtures/auth-upgrade).
//   2. control  push the 1.0 schema with `bcnConsentId` required, as it was
//               before the fix: the backend must reject it, which proves that
//               it validates the stored beta rows.
//   3. 1.0      push the unchanged 1.0 component and run upgrade:verifyUpgrade.
//
// Every push names the pinned backend and fixed ports, and the stored
// deployment must still run that version afterwards: a Convex CLI backend
// upgrade would move the data through export and import, the path this rules out.
// Set BCN_AUTH_UPGRADE_KEEP=1 to keep the temporary deployment directory.
import { spawnSync } from 'node:child_process'
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
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ensureLocalBackend } from '../helpers/local-backend.mjs'
import { availablePort, cleanEnvironment, convexCli, root } from './harness'

const fixture = 'test/fixtures/auth-upgrade'
const componentSource = path.join(root, 'src/runtime/convex-auth/component')
const requiredField = 'bcnConsentId: v.union(v.null(), v.string()),'
const optionalField = 'bcnConsentId: v.optional(v.union(v.null(), v.string())),'

const convexEnv = () => ({
  ...cleanEnvironment(),
  CONVEX_AGENT_MODE: 'anonymous',
  CONVEX_ALLOW_ANONYMOUS: 'true',
})

describe('auth upgrade from 1.0.0-beta.7', () => {
  let parent: string
  let app: string
  let pin: { version: string; cloudPort: number; sitePort: number }

  /** One `convex dev --once` push pinned to the reviewed backend and ports. */
  function push(extra: string[] = []) {
    const result = spawnSync(
      process.execPath,
      [
        convexCli,
        'dev',
        '--once',
        '--typecheck',
        'disable',
        '--tail-logs',
        'disable',
        '--local-backend-version',
        pin.version,
        '--local-cloud-port',
        String(pin.cloudPort),
        '--local-site-port',
        String(pin.sitePort),
        ...extra,
      ],
      { cwd: app, env: convexEnv(), encoding: 'utf8', timeout: 300_000 },
    )
    if (result.error) throw result.error
    const output = `${result.stdout}\n${result.stderr}`
    const tail = output.trim().split('\n').slice(-40).join('\n')
    const config = JSON.parse(
      readFileSync(path.join(app, '.convex/local/default/config.json'), 'utf8'),
    ) as {
      backendVersion?: string
    }
    expect(config.backendVersion, `the deployment left the pinned backend\n${tail}`).toBe(
      pin.version,
    )
    let value: unknown
    try {
      // `convex dev --run` prints the function result, and only that, to stdout.
      value = JSON.parse(result.stdout)
    } catch {
      value = undefined
    }
    return { ok: result.status === 0, output, tail, value }
  }

  function writeComponent(files: Record<string, string>) {
    const directory = path.join(app, 'convex/betterAuth')
    for (const name of ['schema.ts', 'schemaMetadata.ts', 'adapter.ts'])
      rmSync(path.join(directory, name), { force: true })
    for (const [name, content] of Object.entries(files))
      writeFileSync(path.join(directory, name), content)
  }

  beforeAll(async () => {
    const backend = await ensureLocalBackend()
    parent = mkdtempSync(path.join(tmpdir(), 'bcn-auth-upgrade-'))
    // Mirror the repository layout so fixture imports of ../../../../src resolve.
    app = path.join(parent, fixture)
    symlinkSync(path.join(root, 'src'), path.join(parent, 'src'), 'dir')
    symlinkSync(path.join(root, 'node_modules'), path.join(parent, 'node_modules'), 'dir')
    mkdirSync(app, { recursive: true })
    cpSync(path.join(root, fixture), app, {
      recursive: true,
      filter: (source) => !/(?:^|\/)(?:_generated|\.convex|\.env[^/]*)$/u.test(source),
    })
    const convexVersion = (
      JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
        devDependencies: { convex: string }
      }
    ).devDependencies.convex
    writeFileSync(
      path.join(app, 'package.json'),
      `${JSON.stringify({ name: 'bcn-auth-upgrade', private: true, type: 'module', dependencies: { convex: convexVersion } })}\n`,
    )
    const cloudPort = await availablePort()
    pin = {
      version: backend.version,
      cloudPort,
      sitePort: await availablePort(new Set([cloudPort])),
    }
  })

  afterAll(() => {
    if (!parent) return
    if (process.env.BCN_AUTH_UPGRADE_KEEP === '1') console.log(`[auth-upgrade] kept ${parent}`)
    else rmSync(parent, { force: true, recursive: true })
  })

  it('upgrades seeded beta.7 data with a normal push, and only because the new column is optional', () => {
    const currentSchema = readFileSync(path.join(componentSource, 'schema.ts'), 'utf8')
    expect(
      currentSchema,
      'the 1.0 schema no longer declares the optional bcnConsentId column',
    ).toContain(optionalField)

    writeComponent({ 'schema.ts': readFileSync(path.join(app, 'beta7/schema.ts'), 'utf8') })
    const beta = push(['--run', 'upgrade:seedBeta'])
    expect(beta.ok, `the beta.7 deployment or its seed failed\n${beta.tail}`).toBe(true)
    expect(beta.value).toBeTypeOf('object')

    // Production Convex runtimes require the proxy IP secret for the OAuth profile.
    const env = spawnSync(process.execPath, [convexCli, 'env', 'set', 'BCN_AUTH_PROXY_IP_SECRET'], {
      cwd: app,
      env: convexEnv(),
      encoding: 'utf8',
      input: 'synthetic-auth-upgrade-proxy-ip-secret-32b\n',
      timeout: 300_000,
    })
    expect(env.status, env.stderr).toBe(0)

    // Control: the pre-fix schema must not deploy over beta refresh tokens without bcnConsentId.
    writeComponent({ 'schema.ts': currentSchema.replace(optionalField, requiredField) })
    const control = push()
    expect(
      control.ok,
      `the control push succeeded, so this run proves nothing\n${control.tail}`,
    ).toBe(false)
    expect(control.output).toContain('Schema validation failed')
    expect(control.output).toContain('bcnConsentId')

    // The packaged adapter, importing the shared adapter functions from source.
    const adapterSource = readFileSync(path.join(componentSource, 'adapter.ts'), 'utf8')
    const target = path
      .relative(
        path.join(app, 'convex/betterAuth'),
        path.join(parent, 'src/runtime/convex-auth/adapter'),
      )
      .split(path.sep)
      .join('/')
    const adapter = adapterSource.replace(
      "from '../adapter/define-functions'",
      `from '${target}/define-functions'`,
    )
    expect(adapter, 'the packaged adapter no longer imports ../adapter/define-functions').not.toBe(
      adapterSource,
    )
    writeComponent({
      'schema.ts': currentSchema,
      'schemaMetadata.ts': readFileSync(path.join(componentSource, 'schemaMetadata.ts'), 'utf8'),
      'adapter.ts': adapter,
    })
    const upgrade = push(['--run', 'upgrade:verifyUpgrade'])
    expect(upgrade.ok, `the 1.0 push or its checks failed\n${upgrade.tail}`).toBe(true)
    expect(upgrade.value, upgrade.tail).toMatchObject({ upgrade: 'passed' })
  })
})
