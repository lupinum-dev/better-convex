import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getPackageCheckerProfile } from '../../scripts/package-check/entry-rules.mjs'
import { checkPackageJsonManifestConsistency } from '../../scripts/package-check/manifest-consistency.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const nuxtPackageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
const nuxtProfile = getPackageCheckerProfile('nuxt')

describe('package license consistency', () => {
  it('keeps every package license identical to the repository license', () => {
    const canonical = readFileSync(resolve(repositoryRoot, 'LICENSE'), 'utf8')

    for (const file of ['packages/mcp/LICENSE', 'packages/vue/LICENSE']) {
      expect(readFileSync(resolve(repositoryRoot, file), 'utf8'), file).toBe(canonical)
    }
  })
})

describe('public README consistency', () => {
  const readmes = ['README.md', 'packages/vue/README.md', 'packages/mcp/README.md']

  it('keeps the public READMEs on the Lupinum structure', () => {
    for (const file of readmes) {
      const source = readFileSync(resolve(repositoryRoot, file), 'utf8')
      const h1Count = (source.match(/^# /gmu)?.length ?? 0) + (source.match(/<h1\b/gu)?.length ?? 0)

      expect(h1Count, file).toBe(1)
      expect(source, file).toContain('width="128"')
      expect(source, file).toContain('https://better-convex.lupinum.com')
      expect(source, file).toContain('https://github.com/lupinum-dev/better-convex')
      expect(source, file).toContain('MIT License')
      expect(source, file).toContain('npm/v/')
      expect(source, file).toContain('actions/workflows/ci.yml')
      expect(source, file).toContain('license-MIT')
      expect(source, file).toContain('> [!WARNING]')
      expect(source, file).not.toMatch(/\b(?:TODO|TBD|PLACEHOLDER)\b/iu)

      for (const match of source.matchAll(/^## (.+)$/gmu)) {
        const heading = match[1]!.trim()
        const unexpected = heading
          .split(/\s+/u)
          .slice(1)
          .filter(
            (word) =>
              /^[A-Z][A-Za-z-]*$/u.test(word) &&
              !['Better', 'Convex', 'MCP', 'Nuxt', 'Vue'].includes(word),
          )
        expect(unexpected, `${file}: ${heading}`).toEqual([])
      }
    }

    const rootReadme = readFileSync(resolve(repositoryRoot, 'README.md'), 'utf8')
    const sections = [
      'Why use Better Convex?',
      'When to use it',
      'Requirements',
      'Installation',
      'Quick start',
      'Server calls and mutations',
      'Authentication',
      'Packages',
      'Documentation',
      'Contributing and development',
      'Support and security',
      'License',
    ]
    const positions = sections.map((section) => rootReadme.indexOf(`## ${section}`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))

    const packageSections = [
      'Purpose',
      'Requirements',
      'Installation',
      'Quick start',
      'Exports',
      'Documentation',
      'Support and security',
      'License',
    ]
    for (const file of readmes.slice(1)) {
      const source = readFileSync(resolve(repositoryRoot, file), 'utf8')
      const packagePositions = packageSections.map((section) => source.indexOf(`## ${section}`))
      expect(
        packagePositions.every((position) => position >= 0),
        file,
      ).toBe(true)
      expect(packagePositions, file).toEqual(
        [...packagePositions].sort((left, right) => left - right),
      )
    }
  })

  it('uses Better Convex as the documentation product name', () => {
    expect(readFileSync(resolve(repositoryRoot, 'docs/app/app.config.ts'), 'utf8')).toContain(
      "name: { en: 'Better Convex' }",
    )
    expect(readFileSync(resolve(repositoryRoot, 'docs/content.config.ts'), 'utf8')).toContain(
      "name: 'Better Convex'",
    )
    expect(readFileSync(resolve(repositoryRoot, 'docs/content/docs/index.md'), 'utf8')).toContain(
      'title: Better Convex documentation',
    )
  })
})

describe('contributor intake consistency', () => {
  it('keeps documentation reports, release notes, and risk visible', () => {
    const trackedFiles = new Set(
      execFileSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' })
        .trim()
        .split('\n'),
    )
    for (const path of [
      '.github/ISSUE_TEMPLATE/bug.md',
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/ISSUE_TEMPLATE/documentation.md',
      '.github/ISSUE_TEMPLATE/proposal.md',
      '.github/pull_request_template.md',
    ]) {
      expect(trackedFiles.has(path), `${path} must be tracked`).toBe(true)
    }
    expect(
      readFileSync(resolve(repositoryRoot, '.github/ISSUE_TEMPLATE/documentation.md'), 'utf8'),
    ).toContain('name: Documentation report')

    const pullRequestTemplate = readFileSync(
      resolve(repositoryRoot, '.github/pull_request_template.md'),
      'utf8',
    )
    for (const heading of [
      'Result',
      'Verification',
      'Documentation and compatibility',
      'Release note',
      'Risk',
    ]) {
      expect(pullRequestTemplate).toContain(`## ${heading}`)
    }
    expect(pullRequestTemplate).toContain(
      '- [ ] I ran `pnpm verify`, or I explained why it does not apply.',
    )
    expect(pullRequestTemplate).toContain(
      '- [ ] I updated versions, migration guidance, and compatibility notes when the public contract changed.',
    )

    const maintaining = readFileSync(resolve(repositoryRoot, 'MAINTAINING.md'), 'utf8')
    for (const heading of [
      'Quick fixes',
      'Large changes',
      'Dependencies',
      'Releases',
      'Roll back a defective release',
      'Respond to a credential incident',
      'Documentation',
    ]) {
      expect(maintaining).toContain(`## ${heading}`)
    }

    const releasing = readFileSync(resolve(repositoryRoot, 'RELEASING.md'), 'utf8')
    const bootstrapHeading = '## First-package bootstrap'
    const bootstrapStart = releasing.indexOf(bootstrapHeading)
    const bootstrapEnd = releasing.indexOf('\n## ', bootstrapStart + bootstrapHeading.length)
    expect(bootstrapStart).toBeGreaterThanOrEqual(0)
    expect(bootstrapEnd).toBeGreaterThan(bootstrapStart)

    const bootstrap = releasing.slice(bootstrapStart, bootstrapEnd)
    const afterBootstrap = releasing.slice(bootstrapEnd)
    expect(bootstrap).toContain('npm therefore rejects its trusted-publisher configuration')
    expect(bootstrap).toMatch(/--access\s+public --tag <channel> --ignore-scripts/u)
    expect(bootstrap).toContain('`latest` for')
    expect(bootstrap).toContain('`next` for a prerelease')
    expect(bootstrap).toContain('two-factor authentication for')
    expect(bootstrap).toContain('authorization and writes')
    expect(bootstrap).toContain('Do not use an access token that bypasses two-factor')
    expect(bootstrap).toContain('Let npm request the one-time')
    expect(afterBootstrap).not.toMatch(
      /(?:workstation|owning human).{0,120}(?:publish|tag|release)/su,
    )
    expect(afterBootstrap).not.toMatch(/--access\s+public --tag <channel> --ignore-scripts/u)
    expect(releasing).toMatch(/Later versions have no workstation\s+publication path\./u)
  })
})

describe('documentation service configuration', () => {
  it('keeps analytics, feedback, support, and legal links configured', () => {
    const config = readFileSync(resolve(repositoryRoot, 'docs/app/app.config.ts'), 'utf8')
    for (const marker of [
      "plausible: { scriptId: '03E34LSIgT0kGko07f39A' }",
      'feedback: { enabled: true }',
      'https://discord.gg/RPH6SeA36N',
      'https://lupinum.com/impressum',
      'https://lupinum.com/datenschutz',
    ]) {
      expect(config).toContain(marker)
    }
  })
})

function cloneNuxtManifest() {
  return structuredClone(nuxtPackageJson)
}

function copyBinTargets(artifactRoot: string, manifest: typeof nuxtPackageJson) {
  for (const target of Object.values(manifest.bin) as string[]) {
    const relativeTarget = target.replace(/^\.\//u, '')
    const destination = resolve(artifactRoot, relativeTarget)
    const source = resolve(
      repositoryRoot,
      'src/runtime/cli',
      basename(relativeTarget).replace(/\.js$/u, '.ts'),
    )
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
  }
}

describe('package manifest consistency', () => {
  let artifactRoot: string

  beforeEach(() => {
    artifactRoot = mkdtempSync(join(tmpdir(), 'bcn-package-manifest-'))
    copyBinTargets(artifactRoot, nuxtPackageJson)
  })

  afterEach(() => {
    rmSync(artifactRoot, { recursive: true, force: true })
  })

  function check(manifest = cloneNuxtManifest()) {
    return checkPackageJsonManifestConsistency({
      manifest,
      entries: nuxtProfile.entries,
      expectedBins: nuxtProfile.bins,
      artifactRoot,
    })
  }

  it('accepts the current reviewed Nuxt manifest', () => {
    expect(check()).toEqual([])
  })

  it('applies the same contract independently to a cloned packed-candidate manifest', () => {
    const sourceManifest = cloneNuxtManifest()
    const packedCandidateManifest = structuredClone(sourceManifest)
    packedCandidateManifest.exports['./server'].import = './dist/runtime/server/renamed.js'

    expect(check(sourceManifest)).toEqual([])
    expect(check(packedCandidateManifest)).toContain(
      'package.json exports["./server"].import must be "./dist/runtime/server/index.js" (manifest source of truth)',
    )
  })

  it('rejects extra and missing public entries', () => {
    const extra = cloneNuxtManifest()
    extra.exports['./unreviewed'] = {
      types: './dist/unreviewed.d.ts',
    }
    expect(check(extra)).toContain(
      'package.json exports contains undeclared manifest entry "./unreviewed"',
    )

    const missing = cloneNuxtManifest()
    delete missing.exports['./errors']
    expect(check(missing)).toContain('package.json exports is missing manifest entry "./errors"')
  })

  it('rejects JavaScript and declaration target drift', () => {
    const wrongJavaScript = cloneNuxtManifest()
    wrongJavaScript.exports['./server'].import = './dist/runtime/server/renamed.js'
    expect(check(wrongJavaScript)).toContain(
      'package.json exports["./server"].import must be "./dist/runtime/server/index.js" (manifest source of truth)',
    )

    const wrongDeclaration = cloneNuxtManifest()
    wrongDeclaration.exports['./server'].types = './dist/runtime/server/renamed.d.ts'
    expect(check(wrongDeclaration)).toContain(
      'package.json exports["./server"].types must be "./dist/runtime/server/index.d.ts" (manifest source of truth)',
    )
  })

  it('binds the legacy main entry to the reviewed root runtime', () => {
    const manifest = cloneNuxtManifest()
    manifest.main = './dist/unreviewed.mjs'

    expect(check(manifest)).toContain(
      'package.json main must be "./dist/module.mjs" (manifest source of truth)',
    )
  })

  it('requires the package-level ESM interpretation used by every runtime entry', () => {
    const manifest = cloneNuxtManifest()
    manifest.type = 'commonjs'

    expect(check(manifest)).toContain(
      'package.json type must be "module" for the reviewed ESM entry contract',
    )
  })

  it('rejects undeclared export conditions and runtime imports on types-only entries', () => {
    const extraCondition = cloneNuxtManifest()
    extraCondition.exports['./server'].default = './dist/runtime/server/index.js'
    expect(check(extraCondition)).toContain(
      'package.json exports["./server"] has undeclared condition "default"',
    )

    const typesOnlyImport = cloneNuxtManifest()
    typesOnlyImport.exports['./better-auth/_generated/component.js'].import =
      './dist/runtime/convex-auth/component/_generated/component.js'
    expect(check(typesOnlyImport)).toContain(
      'package.json exports["./better-auth/_generated/component.js"] is types-only and must not declare an import target',
    )
  })

  it('requires the reviewed condition order so types resolve before runtime imports', () => {
    const manifest = cloneNuxtManifest()
    const server = manifest.exports['./server']
    manifest.exports['./server'] = {
      import: server.import,
      types: server.types,
    }

    expect(check(manifest)).toContain(
      'package.json exports["./server"] conditions must be exactly ["types","import"] in that order',
    )
  })

  it('rejects missing and unmatched typesVersions entries', () => {
    const missing = cloneNuxtManifest()
    delete missing.typesVersions['*'].server
    expect(check(missing)).toContain(
      'typesVersions["*"] is missing an entry for exports subpath "server"',
    )

    const extra = cloneNuxtManifest()
    extra.typesVersions['*'].unreviewed = ['./dist/unreviewed.d.ts']
    expect(check(extra)).toContain(
      'typesVersions["*"]["unreviewed"] has no matching exports subpath',
    )
  })

  it('binds the exact typesVersions selector, target, and array shape', () => {
    const wrongTarget = cloneNuxtManifest()
    wrongTarget.typesVersions['*'].server = ['./dist/unreviewed.d.ts']
    expect(check(wrongTarget)).toContain(
      'typesVersions["*"]["server"] must be exactly ["./dist/runtime/server/index.d.ts"] (manifest source of truth)',
    )

    const wrongShape = cloneNuxtManifest()
    wrongShape.typesVersions['*'].server = './dist/runtime/server/index.d.ts'
    expect(check(wrongShape)).toContain(
      'typesVersions["*"]["server"] must be exactly ["./dist/runtime/server/index.d.ts"] (manifest source of truth)',
    )

    const extraSelector = cloneNuxtManifest()
    extraSelector.typesVersions['>=5.0'] = {
      server: ['./dist/unreviewed.d.ts'],
    }
    expect(check(extraSelector)).toContain(
      'package.json typesVersions must contain exactly the "*" selector',
    )
  })

  it('rejects export targets that are not covered by package files', () => {
    const manifest = cloneNuxtManifest()
    manifest.files = manifest.files.filter((entry: string) => entry !== 'dist')

    expect(check(manifest)).toContain(
      'package.json exports["."] target "./dist/types.d.mts" is not covered by "files": ["LICENSES","THIRD_PARTY_NOTICES.md","security/upstream-convex-better-auth.json"]',
    )
  })

  it('rejects bin targets that traverse outside the artifact root', () => {
    const manifest = cloneNuxtManifest()
    manifest.bin['better-convex'] = './dist/../../outside.js'

    expect(check(manifest)).toContain(
      'package.json bin["better-convex"] must point inside ./dist/: ./dist/../../outside.js',
    )
  })

  it('binds the exact reviewed command names and targets', () => {
    const extra = cloneNuxtManifest()
    extra.bin['unreviewed-public-cli'] = './dist/runtime/cli/convex.js'
    expect(check(extra)).toContain(
      'package.json bin contains undeclared command "unreviewed-public-cli"',
    )

    const missing = cloneNuxtManifest()
    delete missing.bin['better-convex']
    expect(check(missing)).toContain('package.json bin is missing reviewed command "better-convex"')

    const retargeted = cloneNuxtManifest()
    retargeted.bin['better-convex'] = './dist/runtime/cli/convex.js'
    expect(check(retargeted)).toContain(
      'package.json bin["better-convex"] must be "./dist/runtime/cli/index.js" (manifest source of truth)',
    )
  })
})
