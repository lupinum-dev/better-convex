import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '..')
const config = JSON.parse(readFileSync(resolve(root, 'docs/vercel.json'), 'utf8'))
const previewWorkflow = readFileSync(resolve(root, '.github/workflows/vercel-preview.yml'), 'utf8')
const previewConfig = parse(previewWorkflow)
const previewSteps = Object.values(previewConfig.jobs ?? {}).flatMap((job) => job.steps ?? [])
const approvedPreviewAction = 'actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd'
const expectedIgnoreCommand = 'node scripts/vercel-ignore.mjs'
const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

check(!existsSync(resolve(root, 'vercel.json')), 'Keep vercel.json in the deployable docs app.')
check(!existsSync(resolve(root, 'demo/vercel.json')), 'The example application must not deploy.')
check(
  previewWorkflow.includes('/v13/deployments'),
  'Create previews through the Vercel deployment API.',
)
check(
  previewWorkflow.includes('checks: write') &&
    previewWorkflow.includes('cancel-in-progress: false'),
  'Report exact-commit preview status without canceling requested builds.',
)
check(
  [
    'getCollaboratorPermissionLevel',
    'AbortSignal.timeout',
    'ignored-build-step',
    'reusedExistingPreview',
    'sha=${encodeURIComponent(commitSha)}&state=READY',
    "candidate.readyState === 'READY'",
    'reportBestEffort',
  ].every((boundary) => previewWorkflow.includes(boundary)),
  'Keep preview authorization, API resilience, exact-SHA reuse, and neutral skip handling.',
)
check(
  previewSteps.length === 1 &&
    previewSteps.every(
      (step) =>
        !Object.hasOwn(step, 'run') &&
        Object.hasOwn(step, 'uses') &&
        step.uses === approvedPreviewAction,
    ),
  'The token-holding preview workflow must use only the approved pinned reporting action.',
)
check(
  !/vercel build|vercel deploy|pnpm install/u.test(previewWorkflow),
  'The token-holding preview workflow must not invoke local deployment commands.',
)
check(config.framework === 'nuxtjs', 'Select the Nuxt framework explicitly.')
check(
  config.git?.deploymentEnabled?.['**'] === false &&
    config.git.deploymentEnabled.main === true &&
    Object.keys(config.git.deploymentEnabled).length === 2,
  'Deploy main automatically and require /vercel for pull-request previews.',
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
