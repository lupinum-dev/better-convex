import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { parse } from 'yaml'

import { checkDependencyPolicy } from './check-dependency-policy.mjs'
import { prepareConsumerDependencyPolicy } from './consumer-dependency-policy.mjs'

const now = Date.parse('2026-09-06T12:00:00Z')
const policy =
  'minimumReleaseAge: 1440\nminimumReleaseAgeStrict: true\nminimumReleaseAgeIgnoreMissingTime: false\n'
const exception = (expires, name = 'example@1.2.3') =>
  `${policy}minimumReleaseAgeExclude:\n  - '${name}' # ${JSON.stringify({ reason: 'Reviewed test fixture', owner: 'maintainer', expires })}\n`

function temporary(run) {
  const directory = mkdtempSync(join(tmpdir(), 'better-convex-policy-'))
  try {
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('exact reviewed exceptions expire at their boundary and cannot exceed one day', () => {
  assert.deepEqual(checkDependencyPolicy(exception('2026-09-06T12:00:01Z'), now), [])
  assert.match(checkDependencyPolicy(exception('2026-09-06T12:00:00Z'), now).join(), /expired/)
  assert.match(
    checkDependencyPolicy(exception('2026-09-07T12:00:01Z'), now).join(),
    /within 24 hours/,
  )
  assert.match(
    checkDependencyPolicy(exception('2026-09-06T13:00:00Z', 'example@*'), now).join(),
    /exact/,
  )
  assert.match(
    checkDependencyPolicy(`${policy}minimumReleaseAgeExclude:\n  - example@1.2.3\n`, now).join(),
    /inline JSON/,
  )
  assert.match(
    checkDependencyPolicy(
      policy.replace('minimumReleaseAge: 1440', '# minimumReleaseAge: 1440'),
      now,
    ).join(),
    /must be 1440/,
  )
})

test('generated consumers inherit maintained age settings without workspace resolutions', () =>
  temporary((directory) => {
    const cutoff = prepareConsumerDependencyPolicy(directory, now)
    const actual = parse(readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8'))
    assert.deepEqual(
      checkDependencyPolicy(readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8'), now),
      [],
    )
    assert.equal(actual.overrides, undefined)
    assert.equal(actual.packageExtensions, undefined)
    assert.equal(cutoff, '--before=2026-09-05T12:00:00.000Z')
  }))

test('companion overrides and valid inline metadata survive generated-policy preparation', () =>
  temporary((directory) => {
    const path = join(directory, 'pnpm-workspace.yaml')
    const source = `${exception('2026-09-06T13:00:00Z')}overrides:\n  companion: file:./companion.tgz\n`
    writeFileSync(path, source)
    prepareConsumerDependencyPolicy(directory, now)
    assert.equal(readFileSync(path, 'utf8'), source)
    assert.throws(() => prepareConsumerDependencyPolicy(directory, now + 3_600_000), /expired/)
  }))

test('existing wrong consumer settings fail instead of being silently replaced', () =>
  temporary((directory) => {
    const path = join(directory, 'pnpm-workspace.yaml')
    writeFileSync(path, policy.replace('1440', '0'))
    assert.throws(() => prepareConsumerDependencyPolicy(directory, now), /must be 1440/)
    assert.equal(parse(readFileSync(path, 'utf8')).minimumReleaseAge, 0)
  }))

test('the actual generated-path CLI rejects an expired install exclusion', () =>
  temporary((directory) => {
    const path = join(directory, 'pnpm-workspace.yaml')
    writeFileSync(path, exception('2000-01-01T00:00:00Z'))
    const failed = spawnSync(process.execPath, ['scripts/check-dependency-policy.mjs', path], {
      encoding: 'utf8',
    })
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /expired/)
    writeFileSync(path, policy)
    const passed = spawnSync(process.execPath, ['scripts/check-dependency-policy.mjs', path], {
      encoding: 'utf8',
    })
    assert.equal(passed.status, 0, passed.stderr)
  }))

test('normal and scheduled workflows enforce policy without building packages', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  const scheduled = parse(readFileSync('.github/workflows/security-extended.yml', 'utf8'))
  assert.ok(scheduled.on.schedule.some(({ cron }) => /^\S+ \S+ \* \* \*$/.test(cron)))
  for (const workflow of [ci, scheduled]) {
    const job = workflow.jobs['dependency-policy']
    assert.equal(job.if, undefined)
    assert.equal(job['continue-on-error'], undefined)
    const commands = job.steps.flatMap((step) => step.run ?? [])
    assert.ok(commands.includes('pnpm install --frozen-lockfile --ignore-scripts'))
    assert.ok(commands.includes('pnpm check:dependency-policy'))
    assert.ok(commands.every((command) => !/pnpm (?:build|release:|test:e2e)/.test(command)))
  }
  const gate = ci.jobs['release-gate']
  assert.ok(gate.needs.includes('dependency-policy'))
  const step = gate.steps.find((entry) => entry.env?.DEPENDENCY_POLICY)
  assert.equal(step.env.DEPENDENCY_POLICY, '${{ needs.dependency-policy.result }}')
  for (const [result, expected] of [
    ['success', 0],
    ['failure', 1],
    ['skipped', 1],
  ]) {
    const trial = spawnSync('bash', ['-e', '-c', step.run], {
      env: {
        ...process.env,
        DEPENDENCY_POLICY: result,
        SOURCE_CERTIFICATION: 'success',
        RELEASE_CANDIDATE: 'skipped',
        GITHUB_EVENT_NAME: 'pull_request',
      },
    })
    assert.equal(trial.status, expected)
  }
})
