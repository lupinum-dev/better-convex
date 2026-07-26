import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function read(path: string) {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('pkg.pr.new package preview workflow', () => {
  const workflow = read('.github/workflows/package-preview.yml')
  const packageJson = JSON.parse(read('package.json')) as {
    devDependencies?: Record<string, string>
  }
  const lockfile = read('pnpm-lock.yaml')

  it('previews same-repository pull-request commits and never executes fork code', () => {
    expect(workflow).toContain('types: [opened, synchronize, reopened]')
    expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository')
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'")
    expect(workflow).toContain('ref: ${{ github.event.pull_request.head.sha || github.sha }}')
    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).not.toContain('pull_request_target')
    expect(workflow).not.toMatch(/^\s+push:/mu)
    expect(workflow).not.toContain('github.event.label')
  })

  it('has read-only repository authority and no registry publication credentials', () => {
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).not.toContain('id-token: write')
    expect(workflow).not.toContain('pull-requests: write')
    expect(workflow).not.toContain('packages: write')
    expect(workflow).not.toContain('NODE_AUTH_TOKEN')
    expect(workflow).not.toContain('NPM_TOKEN')
    expect(workflow).not.toContain('npm publish')
  })

  it('builds the release family once and selects its verified Nuxt artifact', () => {
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm check:auth-backend --install')
    expect(workflow).toContain(
      'node scripts/print-package-artifact-coordinates.mjs --package nuxt >> "$GITHUB_OUTPUT"',
    )
    expect(workflow).toContain(
      "import { getPackageArtifactCoordinates } from './scripts/package-artifact-coordinates.mjs'",
    )
    expect(workflow).toContain("getPackageArtifactCoordinates('nuxt')")
    expect(workflow).toContain('const evidencePath = coordinates.relativePaths.evidence')
    expect(workflow).toContain('PACKAGE_NAME: ${{ steps.artifact.outputs.package_name }}')
    expect(workflow).toContain('evidence.sourceCommit !== expectedSourceCommit')
    expect(workflow).toContain('evidence.tarball?.file !== coordinates.files.tarball')
    expect(workflow).toContain(
      'node scripts/release.mjs verify "${{ steps.artifact.outputs.evidence }}"',
    )
    expect(workflow).not.toContain('`v${packageJson.version}.artifact.json`')
    expect(workflow).not.toContain('`${packageJson.name}-${packageJson.version}.tgz`')
    expect(workflow).not.toMatch(/(?:npm|pnpm) pack/u)
  })

  it('uploads only the prebuilt tarball through the pinned CLI with SHA URLs', () => {
    expect(packageJson.devDependencies?.['pkg-pr-new']).toBe('0.0.78')
    expect(lockfile).toContain('pkg-pr-new:\n        specifier: 0.0.78\n        version: 0.0.78')
    expect(lockfile).toMatch(/pkg-pr-new@0\.0\.78:\n\s+resolution: \{integrity: sha512-[^}]+\}/u)
    expect(workflow.match(/pnpm exec pkg-pr-new publish/g)).toHaveLength(1)
    expect(workflow).toContain('--no-compact')
    expect(workflow).toContain('--commentWithSha')
    expect(workflow).toContain('--no-template')
    expect(workflow).toContain('"${{ steps.artifact.outputs.tarball }}"')
    expect(workflow).not.toMatch(/\b(?:npx|pnpm dlx|yarn dlx|bunx)\b/u)
  })

  it('retains the exact evidence and reports the install URL and candidate hash', () => {
    expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a')
    expect(workflow).toContain('path: ${{ steps.artifact.outputs.directory }}/')
    expect(workflow).not.toContain('path: .release-artifacts/')
    expect(workflow).toContain('PREVIEW_URLS: ${{ steps.publish.outputs.urls }}')
    expect(workflow).toContain('ARTIFACT_SHA256: ${{ steps.artifact.outputs.sha256 }}')
    expect(workflow).toContain(
      'SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}',
    )
    expect(workflow).toContain('if [[ "$PREVIEW_SHA" != "$SOURCE_COMMIT" ]]')
    expect(workflow).toContain(
      'EXPECTED_PREVIEW_URL="https://pkg.pr.new/${GITHUB_REPOSITORY}/${PACKAGE_NAME}@${SOURCE_COMMIT}"',
    )
    expect(workflow).toContain('if [[ "$PREVIEW_URL" != "$EXPECTED_PREVIEW_URL" ]]')
    expect(workflow).toContain('sha256sum --check --strict')
    expect(workflow).not.toMatch(/uses:\s+\S+@v\d/u)
  })
})
