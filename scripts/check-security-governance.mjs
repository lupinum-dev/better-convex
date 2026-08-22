#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function normalizedName(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateSecurityGovernance(input) {
  const failures = []
  const governanceMode = normalizedName(input?.governanceMode)
  const releaseOwner = normalizedName(input?.releaseOwner)
  const commitAuthor = normalizedName(input?.commitAuthor)

  if (governanceMode !== 'solo-maintainer') {
    failures.push('BCN_GOVERNANCE_MODE must be solo-maintainer for this release')
  }
  if (!releaseOwner) failures.push('RELEASE_OWNER must identify the release actor')
  if (/(?:\[bot\]|github-actions)$/iu.test(releaseOwner)) {
    failures.push('RELEASE_OWNER must identify a human release actor')
  }
  if (!commitAuthor) failures.push('the checked-out release commit must have an author')

  return failures
}

export function validateReleaseIdentity(releaseTag, packageVersion, releaseTarget) {
  const prefix = releaseTarget === 'mcp' ? 'mcp-v' : releaseTarget === 'vue-nuxt' ? 'v' : undefined
  if (
    !prefix ||
    typeof releaseTag !== 'string' ||
    typeof packageVersion !== 'string' ||
    releaseTag !== `${prefix}${packageVersion}`
  ) {
    return ['tag must exactly match the selected release target version']
  }
  return []
}

function parseArguments(arguments_) {
  const release = arguments_.includes('--release')
  const unknown = arguments_.filter((argument) => argument !== '--release')
  if (unknown.length > 0) throw new Error(`unknown governance-check option: ${unknown[0]}`)
  if (!release) throw new Error('the governance check is only defined for --release')
  return { release }
}

function run() {
  parseArguments(process.argv.slice(2))
  const commitAuthor = execFileSync('git', ['show', '-s', '--format=%an <%ae>', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
  const governance = {
    commitAuthor,
    governanceMode: process.env.BCN_GOVERNANCE_MODE,
    releaseOwner: process.env.RELEASE_OWNER,
  }
  const failures = validateSecurityGovernance(governance)
  const manifest =
    process.env.RELEASE_TARGET === 'mcp' ? 'packages/mcp/package.json' : 'package.json'
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, manifest), 'utf8'))
  failures.push(
    ...validateReleaseIdentity(
      process.env.RELEASE_TAG,
      packageJson.version,
      process.env.RELEASE_TARGET,
    ),
  )

  if (failures.length > 0) {
    console.error(`Security governance check failed with ${failures.length} issue(s):`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(
    JSON.stringify({
      commitAuthor,
      governanceMode: governance.governanceMode,
      releaseOwner: governance.releaseOwner,
      releaseTag: process.env.RELEASE_TAG,
      sourceCommit: process.env.GITHUB_SHA ?? null,
    }),
  )
  console.log('Solo-maintainer release governance check passed.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
