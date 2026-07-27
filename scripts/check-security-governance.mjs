#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function normalizedName(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateSecurityGovernance(input, { requireLicensingReviewer = false } = {}) {
  const failures = []
  const owner = normalizedName(input?.owner)
  const licensingReviewer = normalizedName(input?.licensingReviewer)

  if (!owner) failures.push('BCN_SECURITY_OWNER must name the current Security Owner')
  if (requireLicensingReviewer && !licensingReviewer) {
    failures.push('BCN_LICENSE_REVIEWER must name the human who reviewed package licensing')
  }

  return failures
}

export function validatePrereleaseIdentity(releaseTag, packageVersion) {
  if (
    typeof releaseTag !== 'string' ||
    typeof packageVersion !== 'string' ||
    releaseTag !== `v${packageVersion}` ||
    !packageVersion.includes('-')
  ) {
    return ['tag must exactly match a prerelease package version']
  }
  return []
}

function parseArguments(arguments_) {
  const prerelease = arguments_.includes('--prerelease')
  const unknown = arguments_.filter((argument) => argument !== '--prerelease')
  if (unknown.length > 0) throw new Error(`unknown governance-check option: ${unknown[0]}`)
  return { prerelease }
}

function run() {
  const { prerelease } = parseArguments(process.argv.slice(2))
  const failures = validateSecurityGovernance(
    {
      licensingReviewer: process.env.BCN_LICENSE_REVIEWER,
      owner: process.env.BCN_SECURITY_OWNER,
    },
    { requireLicensingReviewer: prerelease },
  )

  if (prerelease) {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
    failures.push(...validatePrereleaseIdentity(process.env.RELEASE_TAG, packageJson.version))
  }

  if (failures.length > 0) {
    console.error(`Security governance check failed with ${failures.length} issue(s):`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }
  console.log('Security governance metadata check passed.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
