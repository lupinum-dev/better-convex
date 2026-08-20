import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const config = JSON.parse(readFileSync(resolve(root, 'docs/vercel.json'), 'utf8'))
const expectedIgnoreCommand = 'node scripts/vercel-ignore.mjs'
const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

check(!existsSync(resolve(root, 'vercel.json')), 'Keep vercel.json in the deployable docs app.')
check(!existsSync(resolve(root, 'demo/vercel.json')), 'The example application must not deploy.')
check(config.framework === 'nuxtjs', 'Select the Nuxt framework explicitly.')
check(
  config.git?.deploymentEnabled === true,
  'Create a Vercel status for every pull-request commit.',
)
check(
  config.ignoreCommand === expectedIgnoreCommand,
  'Skip deployments that cannot affect the documentation app.',
)
const runIgnoreCommand = (previousSha) =>
  spawnSync('sh', ['-c', config.ignoreCommand], {
    cwd: resolve(root, 'docs'),
    env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previousSha },
  })
check(
  runIgnoreCommand('0000000000000000000000000000000000000000').status === 1,
  'Build when a rebased or force-pushed previous commit is unavailable.',
)
check(
  runIgnoreCommand('HEAD').status === 0,
  'Skip the build when documentation inputs are unchanged.',
)
check(config.outputDirectory === null, 'Let Nuxt and Vercel detect .vercel/output.')
check(config.buildCommand === 'pnpm build', 'Build the documentation app directly.')
check(!('installCommand' in config), 'Let Vercel detect pnpm from the documentation lockfile.')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Vercel app-root contract: ok')
