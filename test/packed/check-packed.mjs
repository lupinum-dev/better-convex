// Packs the published packages exactly as `pnpm pack` does for a release, then:
// - runs publint and @arethetypeswrong/cli (ESM-only profile) on each tarball;
// - imports every public entry through the packed `exports` map, with the packed Vue
//   package resolving before the workspace copy (dependencies resolve from the repo);
// - fails when a tarball contains env files, keys, or secret-like test credentials.
// Run after `pnpm build`.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
export const packageDirectories = {
  vue: 'packages/vue',
  nuxt: '.',
  functions: 'packages/functions',
  agents: 'packages/agents',
}

/** Packs every published package into `destination` and returns its tarball path by id. */
export function packWorkspace(destination) {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  const tarballs = {}
  for (const [id, directory] of Object.entries(packageDirectories)) {
    const before = new Set(readdirSync(destination))
    execFileSync('pnpm', ['pack', '--pack-destination', destination], {
      cwd: join(root, directory),
      stdio: 'ignore',
    })
    const [file] = readdirSync(destination).filter((name) => !before.has(name))
    if (!file) throw new Error(`pnpm pack produced no tarball for ${directory}`)
    tarballs[id] = join(destination, file)
  }
  return tarballs
}

const forbiddenPaths = [
  /(^|\/)\.env(\.|$)/,
  /\.(pem|key|p12)$/,
  /(^|\/)(\.convex|node_modules|\.nuxt)\//,
  /^(test|playground|scripts|src)\//,
]
const forbiddenContent = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(npm_[A-Za-z0-9]{36}|gh[pousr]_[A-Za-z0-9]{36}|sk_live_[A-Za-z0-9]{16,})\b/,
  /\b(?:prod|preview|dev):[\w-]+\|[\w+/=]{20,}/, // a Convex deploy key
  // The shape of the synthetic secrets used by this repository's tests and fixtures.
  /[\w-]*secret[\w-]*-(?:with-)?(?:32|at-least|adequate)[\w-]*|secret-sentinel|do-not-leak/i,
]

function files(directory) {
  return readdirSync(directory, { recursive: true })
    .map((name) => join(directory, name))
    .filter((path) => statSync(path).isFile())
}

function checkOptionalAuthCli(tarball) {
  // Outside the repository so its development peers cannot satisfy CLI imports.
  const consumer = mkdtempSync(join(tmpdir(), 'better-convex-cli-no-auth-'))
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', consumer, '--strip-components=1'])
    const manifest = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'))
    const cli = join(consumer, manifest.bin['better-convex'])
    const require = createRequire(cli)
    const peers = ['better-auth', '@better-auth/core', '@better-auth/oauth-provider']
    for (const peer of peers) {
      assert.throws(() => require.resolve(peer), { code: 'MODULE_NOT_FOUND' })
    }
    for (const [args, expected] of [
      [['--help'], 'Usage:'],
      [['--version'], manifest.version],
      [['init', '--help'], 'Usage: better-convex init'],
      [['convex', '--help'], 'Run the pinned Convex CLI'],
    ]) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: consumer,
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stderr}`)
      assert.ok(result.stdout.includes(expected), result.stdout)
      assert.equal(result.stderr, '')
    }
    const auth = spawnSync(process.execPath, [cli, 'auth', 'schema'], {
      cwd: consumer,
      encoding: 'utf8',
    })
    assert.equal(auth.status, 1)
    const install = peers.map((peer) => `${peer}@${manifest.peerDependencies[peer]}`).join(' ')
    assert.equal(
      auth.stderr.trim(),
      `[better-convex] better-convex auth schema needs the optional Better Auth packages. Install them with: pnpm add ${install}`,
    )
    console.log(
      'Packed CLI without Better Auth: help, version, init/convex help and auth install hint passed.',
    )
  } finally {
    rmSync(consumer, { recursive: true, force: true })
  }
}

function main() {
  const smoke = join(root, 'node_modules/.cache/packed-smoke')
  const tarballs = packWorkspace(join(smoke, 'tarballs'))
  checkOptionalAuthCli(tarballs.nuxt)
  const failures = []

  for (const [id, tarball] of Object.entries(tarballs)) {
    execFileSync('pnpm', ['exec', 'publint', tarball], { cwd: root, stdio: 'inherit' })
    execFileSync(
      'pnpm',
      [
        'exec',
        'attw',
        tarball,
        '--profile',
        'esm-only',
        '--exclude-entrypoints',
        './agent-docs',
        '--format',
        'table-flipped',
      ],
      { cwd: root, stdio: 'inherit' },
    )

    const manifest = JSON.parse(
      execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }),
    )
    const directory = join(smoke, 'node_modules', manifest.name)
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    execFileSync('tar', ['-xzf', tarball, '-C', directory, '--strip-components=1'])

    for (const path of files(directory)) {
      const name = relative(directory, path).split('\\').join('/')
      if (forbiddenPaths.some((pattern) => pattern.test(name)))
        failures.push(`${manifest.name}: packs ${name}`)
      const text = readFileSync(path, 'utf8')
      const hit = forbiddenContent.map((pattern) => pattern.exec(text)?.[0]).find(Boolean)
      if (hit) failures.push(`${manifest.name}: ${name} contains "${hit.slice(0, 40)}"`)
      if (id === 'nuxt' && text.includes('packages/vue/src'))
        failures.push(`${manifest.name}: ${name} bundles Vue package source`)
    }

    const specifiers = []
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const targets = typeof target === 'string' ? [target] : Object.values(target)
      for (const file of targets) {
        if (!existsSync(join(directory, file)))
          failures.push(`${manifest.name}: export ${subpath} -> ${file} is missing`)
      }
      if (typeof target === 'object' && target.import)
        specifiers.push(`${manifest.name}${subpath.slice(1)}`)
    }
    for (const bin of Object.values(
      typeof manifest.bin === 'string' ? { bin: manifest.bin } : (manifest.bin ?? {}),
    )) {
      if (!existsSync(join(directory, bin)))
        failures.push(`${manifest.name}: bin ${bin} is missing`)
    }
    const script = join(smoke, `import-${id}.mjs`)
    writeFileSync(
      script,
      specifiers.map((specifier) => `await import(${JSON.stringify(specifier)})\n`).join('') +
        (id === 'vue' || id === 'nuxt'
          ? `const { default: assert } = await import('node:assert/strict')\nconst stable = await import(${JSON.stringify(manifest.name)})\nconst experimental = await import(${JSON.stringify(`${manifest.name}/experimental`)})\nassert.equal(typeof experimental.useConvexOperation, 'function')\nassert.equal('useConvexOperation' in stable, false)\n`
          : ''),
    )
    try {
      execFileSync(process.execPath, [script], { cwd: smoke, stdio: 'pipe' })
      console.log(`${manifest.name}@${manifest.version}: imported ${specifiers.join(', ')}`)
    } catch (error) {
      failures.push(`${manifest.name}: importing the packed entries failed:\n${error.stderr}`)
    }
  }

  if (failures.length) {
    console.error(failures.map((failure) => `- ${failure}`).join('\n'))
    process.exit(1)
  }
  console.log('Packed packages look good.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
