// Installs freshly packed local tarballs into temporary copies of every starter and every
// consumer app (test/fixtures/consumers), and runs its typecheck, declaration emit and tests.
// Starters also run their production build; consumer apps have no Nuxt app to build. Then it
// runs the packed Vue, Nuxt and MCP consumer apps in a browser. Nothing is fetched from npm
// for our own packages. Run after `pnpm build`, which also writes the packaged agent docs.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { packWorkspace } from './check-packed.mjs'

const root = resolve(import.meta.dirname, '../..')
const scratch = mkdtempSync(join(tmpdir(), 'better-convex-starters-'))
const skip = new Set(['node_modules', '.nuxt', '.output', '.data', '.convex', 'dist', '.env.local'])
// Placeholder deployment URLs and secrets: the builds must not need a real backend.
const env = {
  ...process.env,
  BCN_AUTH_PROXY_IP_SECRET: 'starter-build-proxy-ip-placeholder-value',
  BETTER_AUTH_SECRETS: '1:starter-build-auth-placeholder-value',
  CI: 'true',
  CONVEX_SITE_URL: 'https://starter-build.convex.site',
  CONVEX_URL: 'https://starter-build.convex.cloud',
  NUXT_PUBLIC_CONVEX_SITE_URL: 'https://starter-build.convex.site',
  NUXT_PUBLIC_CONVEX_URL: 'https://starter-build.convex.cloud',
  NUXT_TELEMETRY_DISABLED: '1',
  SITE_URL: 'http://127.0.0.1:3000',
}
const run = (command, args, cwd, extra = {}) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...env, ...extra } })

try {
  const tarballs = packWorkspace(join(scratch, 'tarballs'))
  const packed = Object.fromEntries(
    Object.entries(tarballs).map(([id, tarball]) => [
      id,
      JSON.parse(
        execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }),
      ),
    ]),
  )
  const exactPeers = Object.fromEntries(
    [packed.nuxt, packed.agents]
      .flatMap((manifest) => Object.entries(manifest.peerDependencies ?? {}))
      .filter(([, version]) => /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)),
  )

  const apps = ['starters', 'test/fixtures/consumers'].flatMap((folder) =>
    readdirSync(join(root, folder))
      .map((name) => `${folder}/${name}`)
      .filter((path) => existsSync(join(root, path, 'package.json'))),
  )
  for (const path of apps) {
    const source = join(root, path)
    const starter = path.startsWith('starters/')
    const name = path.replaceAll('/', '-')
    const app = join(scratch, name)
    cpSync(source, app, {
      recursive: true,
      filter: (path) => !skip.has(path.split(/[\\/]/).at(-1)),
    })

    const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
    for (const section of [manifest.dependencies, manifest.devDependencies]) {
      for (const dependency of Object.keys(section ?? {})) {
        if (exactPeers[dependency]) section[dependency] = exactPeers[dependency]
        for (const [id, manifestOfPackage] of Object.entries(packed)) {
          if (manifestOfPackage.name !== dependency) continue
          copyFileSync(tarballs[id], join(app, `${id}.tgz`))
          section[dependency] = `file:./${id}.tgz`
        }
      }
    }
    writeFileSync(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    copyFileSync(tarballs.vue, join(app, 'vue.tgz'))
    writeFileSync(
      join(app, 'pnpm-workspace.yaml'),
      "minimumReleaseAge: 1440\noverrides:\n  '@lupinum/better-convex-vue': file:./vue.tgz\n",
    )

    console.log(`\n=== ${path} with ${packed.nuxt.name}@${packed.nuxt.version} ===`)
    run(
      'pnpm',
      ['install', '--no-frozen-lockfile', '--ignore-scripts', '--strict-peer-dependencies'],
      app,
    )
    run('pnpm', ['run', 'typecheck'], app)
    // An app with `declaration: true` (or project references) must be able to emit its Convex
    // code: every type an exported function has must be nameable from a public entry (V5).
    writeFileSync(
      join(app, 'convex/tsconfig.declaration.json'),
      JSON.stringify({
        extends: './tsconfig.json',
        compilerOptions: {
          noEmit: false,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: join(scratch, `${name}-declarations`),
        },
        // Tests run under Vitest, with its types.
        exclude: ['**/*.test.ts', '**/test.*.ts'],
      }),
    )
    const emitted = spawnSync('pnpm', ['exec', 'tsc', '-p', 'convex/tsconfig.declaration.json'], {
      cwd: app,
      env,
      encoding: 'utf8',
    })
    // In a starter, only types from our packages count: its own Better Auth plugins have
    // unrelated ones. A consumer app has none, so every error counts.
    const errors = emitted.stdout
      .split('\n')
      .filter((line) => /error TS/.test(line) && (!starter || /@lupinum\//.test(line)))
    if (errors.length > 0 || (!starter && emitted.status !== 0))
      throw new Error(`${path} cannot emit declarations:\n${errors.join('\n') || emitted.stdout}`)
    if (manifest.scripts?.test) run('pnpm', ['run', 'test'], app)
    if (starter) run('pnpm', ['run', 'build'], app, { NODE_ENV: 'production' })
  }

  const consumers = [
    ['check-vue-anonymous-consumer.mjs', '--tarball', tarballs.vue],
    ['check-vue-auth-consumer.mjs', '--tarball', tarballs.vue],
    ['check-vue-embedded-consumer.mjs', '--tarball', tarballs.vue],
    [
      'check-nuxt-lifecycle-consumer.mjs',
      '--nuxt-tarball',
      tarballs.nuxt,
      '--vue-tarball',
      tarballs.vue,
    ],
    [
      'check-agents-package-consumer.mjs',
      '--tarball',
      tarballs.agents,
      '--functions-tarball',
      tarballs.functions,
    ],
  ]
  for (const [script, ...args] of consumers) {
    console.log(`\n=== ${script} ===`)
    execFileSync(process.execPath, [join(root, 'test/packed', script), ...args], {
      cwd: root,
      stdio: 'inherit',
    })
  }
  console.log('\nStarters and packed consumers passed.')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
