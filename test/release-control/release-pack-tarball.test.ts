import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildAndPackReleaseTarball } from '../../scripts/pack-release-tarball.mjs'

function sri(path: string) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
}

describe('canonical release tarball packing', () => {
  it('cleans generated state, restores the placeholder, and reproduces exact bytes', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'bcn-release-pack-'))
    const repository = join(fixture, 'repository')
    const fakeBin = join(fixture, 'bin')
    const firstDestination = join(fixture, 'first')
    const secondDestination = join(fixture, 'second')
    const buildLog = join(fixture, 'build.log')
    mkdirSync(repository)
    mkdirSync(fakeBin)
    mkdirSync(firstDestination)
    mkdirSync(secondDestination)
    writeFileSync(
      join(repository, 'package.json'),
      '{"name":"@lupinum/better-convex-nuxt","version":"1.0.0-beta.1","repository":{"url":"https://github.com/lupinum-dev/better-convex"}}\n',
    )
    mkdirSync(join(repository, 'dist'))
    writeFileSync(join(repository, 'dist/stale.js'), 'stale\n')
    mkdirSync(join(repository, '.nuxt'))
    writeFileSync(join(repository, '.nuxt/stale.ts'), 'stale\n')

    const fakePnpm = join(fakeBin, 'pnpm')
    writeFileSync(
      fakePnpm,
      `#!${process.execPath}
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
appendFileSync(
  process.env.BCN_PACK_BUILD_LOG,
  [
    existsSync(join(process.cwd(), 'dist/stale.js')),
    existsSync(join(process.cwd(), '.nuxt/stale.ts')),
  ].join(',') + '\\n',
)
mkdirSync(join(process.cwd(), 'dist/runtime/shared'), { recursive: true })
writeFileSync(join(process.cwd(), 'dist/module.mjs'), "import { getPackedRuntimeFingerprint } from '../dist/runtime/shared/release-fingerprint.js'\\n")
writeFileSync(join(process.cwd(), 'dist/runtime/shared/release-fingerprint.js'), "const value = '__BCN_RELEASE_RUNTIME_FINGERPRINT__'\\n")
`,
    )
    chmodSync(fakePnpm, 0o755)

    const fakeNpm = join(fakeBin, 'npm')
    writeFileSync(
      fakeNpm,
      `#!${process.execPath}
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as tar from ${JSON.stringify(import.meta.resolve('tar'))}
const args = process.argv.slice(2)
const destination = args[args.indexOf('--pack-destination') + 1]
const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const files = ['package.json']
const walk = (directory, prefix) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const relative = prefix + '/' + entry.name
    if (entry.isDirectory()) walk(path, relative)
    else files.push(relative)
  }
}
walk(join(process.cwd(), 'dist'), 'dist')
files.sort()
mkdirSync(destination, { recursive: true })
const filename = manifest.name.replace(/^@/, '').replaceAll('/', '-') + '-' + manifest.version + '.tgz'
const output = join(destination, filename)
tar.c({ cwd: process.cwd(), file: output, gzip: true, mtime: new Date(0), noDirRecurse: true, portable: true, prefix: 'package/', strict: true, sync: true }, files)
const bytes = readFileSync(output)
process.stdout.write(JSON.stringify([{ filename, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'), name: manifest.name, version: manifest.version }]))
`,
    )
    chmodSync(fakeNpm, 0o755)

    const environment = {
      ...process.env,
      BCN_PACK_BUILD_LOG: buildLog,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    }
    try {
      const first = buildAndPackReleaseTarball('nuxt', firstDestination, {
        environment,
        repositoryRoot: repository,
      })
      expect(
        readFileSync(join(repository, 'dist/runtime/shared/release-fingerprint.js'), 'utf8'),
      ).toContain('__BCN_RELEASE_RUNTIME_FINGERPRINT__')
      writeFileSync(join(repository, 'dist/stale.js'), 'stale again\n')
      const second = buildAndPackReleaseTarball('nuxt', secondDestination, {
        environment,
        repositoryRoot: repository,
      })

      expect(readFileSync(buildLog, 'utf8')).toBe('false,false\nfalse,false\n')
      expect(second.runtimeFingerprint).toBe(first.runtimeFingerprint)
      expect(sri(second.tarballPath)).toBe(sri(first.tarballPath))
      expect(readFileSync(second.tarballPath)).toEqual(readFileSync(first.tarballPath))
    } finally {
      rmSync(fixture, { force: true, recursive: true })
    }
  })
})
