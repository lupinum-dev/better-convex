#!/usr/bin/env node
/*
 * Upgrade proof on the reviewed local Convex backend: deploy the auth
 * component schema of 1.0.0-beta.7 with beta-shaped data, then push the 1.0
 * component through a normal `convex dev` push (no export, import, or manual
 * table clearing) and check the result from inside the deployment.
 *
 *   1. beta.7   push the beta.7 schema, seed users, credential and social
 *               accounts with `issuer`, sessions, OAuth client, resource,
 *               consent, access and refresh tokens (test/fixtures/auth-upgrade).
 *   2. control  push the 1.0 schema with `bcnConsentId` required, as it was
 *               before the fix: the backend must reject the push, which proves
 *               that it validates the stored beta rows.
 *   3. 1.0      push the 1.0 schema, schemaMetadata and adapter unchanged from
 *               src/runtime/convex-auth/component and run upgrade:verifyUpgrade.
 *
 * Every push names the reviewed backend version and fixed ports, and the
 * stored deployment config must still name that version afterwards: a Convex
 * CLI upgrade of the local backend would export and re-import the data, which
 * is the path this proof rules out.
 *
 * Set BCN_AUTH_UPGRADE_KEEP=1 to keep the temporary deployment directory.
 */
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
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertCurrentBackendBinary } from './check-auth-backend.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixtureRelative = 'test/fixtures/auth-upgrade'
const componentSource = path.join(root, 'src/runtime/convex-auth/component')
const pushTimeoutMs = 300_000
const requiredField = 'bcnConsentId: v.union(v.null(), v.string()),'
const optionalField = 'bcnConsentId: v.optional(v.union(v.null(), v.string())),'

function fail(message) {
  throw new Error(`[auth-upgrade] ${message}`)
}

async function availablePort(excluded) {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer()
      server.unref()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
      })
    })
    if (port && port !== excluded) return port
  }
}

/** Only an anonymous local deployment: no inherited deployment selection or credential. */
function convexEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.toUpperCase().startsWith('CONVEX_') &&
        !/^(?:NUXT_PUBLIC|VITE)_CONVEX_/u.test(name.toUpperCase()),
    ),
  )
  env.CONVEX_AGENT_MODE = 'anonymous'
  env.CONVEX_ALLOW_ANONYMOUS = 'true'
  return env
}

/** `convex dev --once` pinned to the reviewed backend and ports; the CLI otherwise resolves the latest release. */
export function convexDevArguments(pin, extraArguments = []) {
  if (!pin?.version || !Number.isInteger(pin.cloudPort) || !Number.isInteger(pin.sitePort)) {
    fail('every push needs the reviewed backend version and both local ports')
  }
  return [
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
    ...extraArguments,
  ]
}

/** Fails unless the anonymous deployment in `app` still runs the pinned backend version. */
export function assertPinnedDeployment(app, version) {
  const configPath = path.join(app, '.convex/local/default/config.json')
  let config
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    fail(`no local deployment config at ${configPath}`)
  }
  if (config?.backendVersion !== version) {
    fail(
      `the local deployment runs backend ${JSON.stringify(config?.backendVersion)}, not the reviewed ${version}; a CLI upgrade moves the data through export and import`,
    )
  }
}

/**
 * One `convex dev --once` push; `run` is `spawnSync` outside tests.
 * @param {string} app
 * @param {{ version: string, cloudPort: number, sitePort: number }} pin
 * @param {string} label
 * @param {string[]} extraArguments
 * @param {(command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding) => { status: number | null, stdout?: string, stderr?: string, error?: Error }} [run]
 */
export function push(app, pin, label, extraArguments, run = spawnSync) {
  const cli = path.join(root, 'node_modules/convex/bin/main.js')
  const result = run(process.execPath, [cli, ...convexDevArguments(pin, extraArguments)], {
    cwd: app,
    env: convexEnv(),
    encoding: 'utf8',
    timeout: pushTimeoutMs,
  })
  if (result.error) throw result.error
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  console.log(`[auth-upgrade] ${label}: exit ${result.status}`)
  try {
    assertPinnedDeployment(app, pin.version)
  } catch (error) {
    throw new Error(`${error.message}\n${detail(output)}`, { cause: error })
  }
  return { ok: result.status === 0, output, stdout: result.stdout ?? '' }
}

/** Deployment environment for the 1.0 OAuth profile; a synthetic value, read from stdin. */
function setDeploymentEnv(app, name, value) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/convex/bin/main.js'), 'env', 'set', name],
    {
      cwd: app,
      env: convexEnv(),
      encoding: 'utf8',
      input: `${value}\n`,
      timeout: pushTimeoutMs,
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0)
    fail(`could not set ${name}\n${detail(`${result.stdout}\n${result.stderr}`)}`)
}

function detail(output) {
  return output.trim().split('\n').slice(-40).join('\n')
}

function writeComponent(app, files) {
  const directory = path.join(app, 'convex/betterAuth')
  for (const name of ['schema.ts', 'schemaMetadata.ts', 'adapter.ts']) {
    rmSync(path.join(directory, name), { force: true })
  }
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(directory, name), content)
  }
}

/** The packaged adapter, importing the shared adapter functions from source. */
function currentAdapter(app) {
  const source = readFileSync(path.join(componentSource, 'adapter.ts'), 'utf8')
  const adapterDirectory = path.join(app, 'convex/betterAuth')
  const target = path
    .relative(adapterDirectory, path.join(app, '../../../src/runtime/convex-auth/adapter'))
    .split(path.sep)
    .join('/')
  const rewritten = source.replace(
    "from '../adapter/define-functions'",
    `from '${target}/define-functions'`,
  )
  if (rewritten === source)
    fail('the packaged adapter no longer imports ../adapter/define-functions')
  return rewritten
}

/** `convex dev --run` prints the function result, and only that, to stdout. */
function runResult({ stdout }) {
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}

async function main() {
  if (process.argv.length > 2) fail(`unknown argument ${JSON.stringify(process.argv[2])}`)
  const backend = await assertCurrentBackendBinary()
  const parent = mkdtempSync(path.join(tmpdir(), 'bcn-auth-upgrade-'))
  // Mirror the repository layout so fixture imports of ../../../../src resolve.
  const app = path.join(parent, fixtureRelative)
  try {
    symlinkSync(path.join(root, 'src'), path.join(parent, 'src'), 'dir')
    symlinkSync(path.join(root, 'node_modules'), path.join(parent, 'node_modules'), 'dir')
    mkdirSync(app, { recursive: true })
    cpSync(path.join(root, fixtureRelative), app, {
      recursive: true,
      filter: (source) => !/(?:^|\/)(?:_generated|\.convex|\.env[^/]*)$/u.test(source),
    })
    const convexVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
      .devDependencies.convex
    writeFileSync(
      path.join(app, 'package.json'),
      `${JSON.stringify({ name: 'bcn-auth-upgrade', private: true, type: 'module', dependencies: { convex: convexVersion } }, null, 2)}\n`,
    )

    const betaSchema = readFileSync(path.join(app, 'beta7/schema.ts'), 'utf8')
    const currentSchema = readFileSync(path.join(componentSource, 'schema.ts'), 'utf8')
    const currentMetadata = readFileSync(path.join(componentSource, 'schemaMetadata.ts'), 'utf8')
    if (!currentSchema.includes(optionalField)) {
      fail('the 1.0 schema no longer declares the optional bcnConsentId column this proof expects')
    }

    // 1. The beta.7 deployment and its data.
    writeComponent(app, { 'schema.ts': betaSchema })
    const cloudPort = await availablePort()
    const pin = { version: backend.version, cloudPort, sitePort: await availablePort(cloudPort) }
    const beta = push(app, pin, 'push 1.0.0-beta.7 schema and seed', ['--run', 'upgrade:seedBeta'])
    const seeded = runResult(beta)
    if (!beta.ok || !seeded || typeof seeded !== 'object') {
      fail(`the beta.7 deployment or its seed failed\n${detail(beta.output)}`)
    }
    console.log(`[auth-upgrade] seeded beta rows: ${JSON.stringify(seeded)}`)
    // Production Convex runtimes require the proxy IP secret for the OAuth profile.
    setDeploymentEnv(app, 'BCN_AUTH_PROXY_IP_SECRET', 'synthetic-auth-upgrade-proxy-ip-secret-32b')

    // 2. Control: the pre-fix 1.0 schema must not deploy over beta refresh tokens.
    writeComponent(app, { 'schema.ts': currentSchema.replace(optionalField, requiredField) })
    const control = push(app, pin, 'push 1.0 schema with a required bcnConsentId (must fail)', [])
    if (
      control.ok ||
      !control.output.includes('Schema validation failed') ||
      !control.output.includes('bcnConsentId')
    ) {
      fail(
        `the control push did not fail on beta refresh tokens without bcnConsentId, so this run proves nothing\n${detail(control.output)}`,
      )
    }
    const rejection = control.output.split('\n').find((line) => line.includes('does not match'))
    console.log(`[auth-upgrade] control push rejected as expected: ${rejection?.trim()}`)

    // 3. The 1.0 component through the normal push, then the checks.
    writeComponent(app, {
      'schema.ts': currentSchema,
      'schemaMetadata.ts': currentMetadata,
      'adapter.ts': currentAdapter(app),
    })
    const upgrade = push(app, pin, 'push 1.0 component and verify', [
      '--run',
      'upgrade:verifyUpgrade',
    ])
    const verified = runResult(upgrade)
    if (!upgrade.ok || verified?.upgrade !== 'passed') {
      fail(`the 1.0 push or its checks failed\n${detail(upgrade.output)}`)
    }
    for (const check of verified.checks) console.log(`[auth-upgrade] ok: ${check}`)
    console.log(
      `[auth-upgrade] PASS: 1.0.0-beta.7 auth data upgrades to 1.0 through a normal push on local backend ${backend.version}.`,
    )
  } finally {
    if (process.env.BCN_AUTH_UPGRADE_KEEP === '1') console.log(`[auth-upgrade] kept ${parent}`)
    else rmSync(parent, { force: true, recursive: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
