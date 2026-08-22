import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getPackageArtifactCoordinates,
  validatePackageArtifactVersion,
} from './package-artifact-coordinates.mjs'
import { requirePreparedReleaseNotes } from './release-changelog.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

export function releaseChannelForVersion(version) {
  return validatePackageArtifactVersion(version).includes('-') ? 'next' : 'latest'
}

export function releaseCoordinates(target, workspaceVersion, mcpVersion) {
  if (target === 'vue-nuxt') {
    const version = validatePackageArtifactVersion(workspaceVersion)
    return { tag: `v${version}`, version }
  }
  if (target === 'mcp') {
    const version = validatePackageArtifactVersion(mcpVersion)
    return { tag: `mcp-v${version}`, version }
  }
  throw new Error('Release target must be vue-nuxt or mcp.')
}

function writeMcpMetadata() {
  const coordinates = getPackageArtifactCoordinates('mcp', { repositoryRoot: root })
  const evidence = JSON.parse(readFileSync(coordinates.paths.evidence, 'utf8'))
  const workspace = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const mcp = JSON.parse(readFileSync(join(root, 'packages/mcp/package.json'), 'utf8'))
  const release = releaseCoordinates('mcp', workspace.version, mcp.version)
  writeFileSync(
    join(dirname(coordinates.paths.evidence), 'mcp-release.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceSha: evidence.sourceCommit,
        tag: release.tag,
        version: release.version,
        notes: requirePreparedReleaseNotes(
          readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
          release.tag,
        ),
      },
      null,
      2,
    )}\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'write-mcp-metadata' || process.argv.length !== 3) {
    throw new Error('Usage: release-target.mjs write-mcp-metadata')
  }
  writeMcpMetadata()
}
