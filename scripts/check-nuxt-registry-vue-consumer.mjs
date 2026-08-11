#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { assertCandidateSetManifest } from './package-candidate-set.mjs'
import { inspectConsumerCandidate } from './package-consumer-candidate.mjs'

const root = resolve(import.meta.dirname, '..')
const arguments_ = process.argv.slice(2)
if (arguments_.length !== 2 || arguments_[0] !== '--artifact-set') {
  throw new Error('Usage: check-nuxt-registry-vue-consumer --artifact-set <artifact-set.json>')
}

const set = assertCandidateSetManifest(arguments_[1], root)
const vue = set.packages.find((entry) => entry.packageId === 'vue')
const nuxt = set.packages.find((entry) => entry.packageId === 'nuxt')
if (!vue || !nuxt) throw new Error('Reviewed candidate set must contain Vue and Nuxt.')

const inheritedEnvironment = Object.fromEntries(
  [
    'COREPACK_HOME',
    'HOME',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'LANG',
    'LC_ALL',
    'NODE_EXTRA_CA_CERTS',
    'NO_PROXY',
    'PATH',
    'PNPM_HOME',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USERPROFILE',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'https_proxy',
    'http_proxy',
    'no_proxy',
  ].flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
)
const environment = {
  ...inheritedEnvironment,
  BCN_AUTH_PROXY_IP_SECRET: 'registry-vue-consumer-proxy-ip-secret-32-characters',
  BETTER_AUTH_SECRETS: '1:registry-vue-consumer-auth-secret-32-characters',
  CI: 'true',
  CONVEX_SITE_URL: 'https://registry-vue-consumer.convex.site',
  CONVEX_URL: 'https://registry-vue-consumer.convex.cloud',
  NUXT_PUBLIC_CONVEX_SITE_URL: 'https://registry-vue-consumer.convex.site',
  NUXT_PUBLIC_CONVEX_URL: 'https://registry-vue-consumer.convex.cloud',
  NUXT_TELEMETRY_DISABLED: '1',
  SITE_URL: 'http://127.0.0.1:3000',
  TZ: 'UTC',
}

function run(executable, args, options = {}) {
  console.log(`\n> ${[executable, ...args].join(' ')}`)
  return execFileSync(executable, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: options.env ?? environment,
    stdio: options.capture ? 'pipe' : 'inherit',
  })
}

function copyTrackedFixture(source, destination) {
  const tracked = run('git', ['ls-files', '--cached', '-z', '--', source], {
    capture: true,
  })
    .split('\0')
    .filter(Boolean)
  if (tracked.length === 0) throw new Error('Registry Vue consumer fixture has no tracked files.')
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', source], {
    capture: true,
  })
    .split('\0')
    .filter(Boolean)
  if (untracked.length > 0) {
    throw new Error(`Registry Vue consumer fixture has untracked inputs: ${untracked.join(', ')}`)
  }
  for (const repositoryPath of tracked) {
    const sourcePath = join(root, repositoryPath)
    if (!existsSync(sourcePath)) continue
    const destinationPath = join(destination, relative(source, repositoryPath))
    mkdirSync(dirname(destinationPath), { recursive: true })
    cpSync(sourcePath, destinationPath, { recursive: true })
  }
  copyFileSync(join(root, 'LICENSE'), join(destination, 'LICENSE'))
}

const scratch = mkdtempSync(join(tmpdir(), 'bcn-registry-vue-consumer-'))
let nuxtCandidate
let vueCandidate
try {
  const registryDirectory = join(scratch, 'registry')
  mkdirSync(registryDirectory)
  const packed = JSON.parse(
    run(
      'npm',
      [
        'pack',
        `${vue.packageName}@${set.version}`,
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        registryDirectory,
        '--registry',
        'https://registry.npmjs.org',
      ],
      { capture: true },
    ),
  )
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== 'string') {
    throw new Error('Registry Vue lookup did not produce exactly one tarball.')
  }
  const registryVueTarball = join(registryDirectory, packed[0].filename)
  const candidateVueTarball = resolve(root, vue.tarball)
  if (!readFileSync(registryVueTarball).equals(readFileSync(candidateVueTarball))) {
    throw new Error('Registry Vue tarball bytes differ from the approved candidate.')
  }

  nuxtCandidate = inspectConsumerCandidate({
    packageId: 'nuxt',
    packageName: nuxt.packageName,
    tarballPath: resolve(root, nuxt.tarball),
  })
  vueCandidate = inspectConsumerCandidate({
    packageId: 'vue',
    packageName: vue.packageName,
    tarballPath: candidateVueTarball,
  })
  if (nuxtCandidate.manifest.dependencies?.[vue.packageName] !== set.version) {
    throw new Error('Nuxt candidate does not depend on the exact candidate-set Vue version.')
  }

  const appDirectory = join(scratch, 'consumer')
  mkdirSync(appDirectory)
  copyTrackedFixture('test/fixtures/consumer-smoke', appDirectory)
  const localNuxtTarball = join(appDirectory, 'better-convex-nuxt.tgz')
  copyFileSync(resolve(root, nuxt.tarball), localNuxtTarball)
  const manifestPath = join(appDirectory, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.devDependencies = {
    ...manifest.devDependencies,
    [nuxt.packageName]: 'file:./better-convex-nuxt.tgz',
  }
  Reflect.deleteProperty(manifest.devDependencies, vue.packageName)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry',
      'https://registry.npmjs.org',
    ],
    { cwd: appDirectory },
  )
  const lock = JSON.parse(readFileSync(join(appDirectory, 'package-lock.json'), 'utf8'))
  const lockedVue = lock.packages?.[`node_modules/${vue.packageName}`]
  if (
    lockedVue?.version !== set.version ||
    typeof lockedVue.resolved !== 'string' ||
    !lockedVue.resolved.startsWith('https://registry.npmjs.org/')
  ) {
    throw new Error('Consumer lock did not resolve exact Vue bytes from the public registry.')
  }
  nuxtCandidate.assertInstalled(join(appDirectory, 'node_modules', nuxt.packageName))
  vueCandidate.assertInstalled(join(appDirectory, 'node_modules', vue.packageName))
  run('npm', ['run', 'typecheck'], { cwd: appDirectory })
  run('npm', ['run', 'build'], {
    cwd: appDirectory,
    env: { ...environment, NODE_ENV: 'production' },
  })
  console.log('Registry Vue / unchanged Nuxt production consumer passed.')
} finally {
  nuxtCandidate?.cleanup()
  vueCandidate?.cleanup()
  rmSync(scratch, { force: true, recursive: true })
}
