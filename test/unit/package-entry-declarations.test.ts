import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkEntryExportShape } from '../../scripts/package-check/declarations.mjs'

function withArtifactRoot(run: (artifactRoot: string) => void) {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'bcn-entry-declarations-'))
  try {
    run(artifactRoot)
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true })
  }
}

function writeArtifact(artifactRoot: string, path: string, source: string) {
  const target = join(artifactRoot, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source)
}

function runtimeEntry(valueExports: string[], typeExports: string[] = []) {
  return {
    kind: 'runtime',
    subpath: './synthetic',
    distJs: 'dist/index.mjs',
    distDts: 'dist/index.d.ts',
    valueExports,
    typeExports,
    exactDeclaredExports: true,
    forbiddenNames: [],
  }
}

describe('packed package entry declarations', () => {
  it('classifies a named default declaration as the default export', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export default function named() {}\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export default function named(): void\n')
      const failures: string[] = []

      checkEntryExportShape(runtimeEntry(['default']), failures, artifactRoot)

      expect(failures).toEqual([])
    })
  })

  it('does not let namespace re-exports bypass the exact public surface', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(
        artifactRoot,
        'dist/index.mjs',
        "export const expected = true\nexport * as leaked from './child.mjs'\n",
      )
      writeArtifact(
        artifactRoot,
        'dist/index.d.ts',
        "export declare const expected: true\nexport * as leaked from './child.js'\n",
      )
      const failures: string[] = []

      checkEntryExportShape(runtimeEntry(['expected']), failures, artifactRoot)

      expect(failures).toContainEqual(expect.stringContaining('exports unexpected name "leaked"'))
      expect(failures).toContainEqual(expect.stringContaining('declares unexpected name "leaked"'))
    })
  })

  it('tracks destructured value exports plus type-only declarations', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(
        artifactRoot,
        'dist/index.mjs',
        'const source = { original: true, second: true }\nexport const { original: renamed, second } = source\n',
      )
      writeArtifact(
        artifactRoot,
        'dist/index.d.ts',
        [
          'export declare const renamed: true',
          'export declare const second: true',
          'export type Mode = "ready"',
          'export interface Helpers { readonly value: true }',
          '',
        ].join('\n'),
      )
      const failures: string[] = []

      checkEntryExportShape(
        runtimeEntry(['renamed', 'second'], ['Mode', 'Helpers']),
        failures,
        artifactRoot,
      )

      expect(failures).toEqual([])
    })
  })

  it('rejects value/type declaration-space substitutions', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const foo = true\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export type foo = true\n')
      const missingValue: string[] = []
      checkEntryExportShape(runtimeEntry(['foo']), missingValue, artifactRoot)
      expect(missingValue).toContainEqual(
        expect.stringContaining('value space is missing expected export "foo"'),
      )

      writeArtifact(artifactRoot, 'dist/index.mjs', 'export {}\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export declare const Foo: true\n')
      const phantomValue: string[] = []
      checkEntryExportShape(runtimeEntry([], ['Foo']), phantomValue, artifactRoot)
      expect(phantomValue).toContainEqual(
        expect.stringContaining('value space exports unexpected name "Foo"'),
      )
      expect(phantomValue).toContainEqual(
        expect.stringContaining('type space is missing expected export "Foo"'),
      )
    })
  })

  it('rejects missing and duplicate linked exports semantically', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', "export { expected } from './child.mjs'\n")
      writeArtifact(artifactRoot, 'dist/child.mjs', 'export const other = true\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export declare const expected: true\n')
      const missingTarget: string[] = []
      checkEntryExportShape(runtimeEntry(['expected']), missingTarget, artifactRoot)
      expect(missingTarget).toContainEqual(expect.stringContaining('module-link error TS2305'))

      writeArtifact(
        artifactRoot,
        'dist/index.mjs',
        'const first = true\nconst second = true\nexport { first as expected, second as expected }\n',
      )
      const duplicate: string[] = []
      checkEntryExportShape(runtimeEntry(['expected']), duplicate, artifactRoot)
      expect(duplicate).toContainEqual(expect.stringContaining('module-link error TS2300'))

      writeArtifact(artifactRoot, 'dist/index.mjs', 'export { missing as expected }\n')
      const missingLocal: string[] = []
      checkEntryExportShape(runtimeEntry(['expected']), missingLocal, artifactRoot)
      expect(missingLocal).toContainEqual(expect.stringContaining('module-link error TS2304'))

      writeArtifact(artifactRoot, 'dist/index.mjs', 'export default 1\nexport default 2\n')
      writeArtifact(
        artifactRoot,
        'dist/index.d.ts',
        'declare const value: 1\nexport default value\n',
      )
      const duplicateDefault: string[] = []
      checkEntryExportShape(runtimeEntry(['default']), duplicateDefault, artifactRoot)
      expect(duplicateDefault).toContainEqual(expect.stringContaining('module-link error TS2528'))
    })
  })

  it('checks runtime re-exports against JavaScript bytes instead of adjacent declarations', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', "export { expected } from './child.js'\n")
      writeArtifact(artifactRoot, 'dist/child.js', 'export const wrong = true\n')
      writeArtifact(artifactRoot, 'dist/child.d.ts', 'export declare const expected: true\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export declare const expected: true\n')
      const failures: string[] = []

      checkEntryExportShape(runtimeEntry(['expected']), failures, artifactRoot)

      expect(failures).toContainEqual(expect.stringContaining('module-link error TS2305'))

      rmSync(join(artifactRoot, 'dist/child.js'))
      failures.length = 0
      checkEntryExportShape(runtimeEntry(['expected']), failures, artifactRoot)
      expect(failures).toContainEqual(expect.stringContaining('module-link error TS2307'))

      writeArtifact(artifactRoot, 'dist/index.mjs', "export { expected } from './child.mjs'\n")
      writeArtifact(artifactRoot, 'dist/child.mjs', 'export const wrong = true\n')
      writeArtifact(artifactRoot, 'dist/child.d.mts', 'export declare const expected: true\n')
      failures.length = 0
      checkEntryExportShape(runtimeEntry(['expected']), failures, artifactRoot)
      expect(failures).toContainEqual(expect.stringContaining('module-link error TS2305'))
    })
  })

  it('leaves external package declaration resolution on NodeNext semantics', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', "export { expected } from 'external'\n")
      writeArtifact(artifactRoot, 'dist/index.d.ts', "export { expected } from 'external'\n")
      writeArtifact(
        artifactRoot,
        'node_modules/external/package.json',
        JSON.stringify({
          name: 'external',
          version: '1.0.0',
          type: 'module',
          exports: {
            '.': {
              types: './index.d.ts',
              import: './index.js',
            },
          },
        }),
      )
      writeArtifact(
        artifactRoot,
        'node_modules/external/index.d.ts',
        "export { expected } from './child.js'\n",
      )
      writeArtifact(
        artifactRoot,
        'node_modules/external/child.d.ts',
        'export declare const expected: true\n',
      )
      writeArtifact(
        artifactRoot,
        'node_modules/external/index.js',
        "export { expected } from './child.js'\n",
      )
      writeArtifact(
        artifactRoot,
        'node_modules/external/child.js',
        'export const expected = true\n',
      )
      const failures: string[] = []

      checkEntryExportShape(runtimeEntry(['expected']), failures, artifactRoot)

      expect(failures).toEqual([])
    })
  })

  it('rejects unresolved default exports in public entries', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export default missing\n')
      writeArtifact(
        artifactRoot,
        'dist/index.d.ts',
        'declare const value: true\nexport default value\n',
      )
      const failures: string[] = []

      checkEntryExportShape(runtimeEntry(['default']), failures, artifactRoot)

      expect(failures).toContainEqual(expect.stringContaining('module-link error TS2304'))
    })
  })

  it('rejects declaration-to-declaration runtime import forms', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export {}\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', "export { type Foo } from './child.d.ts'\n")
      writeArtifact(artifactRoot, 'dist/child.d.ts', 'export interface Foo {}\n')
      const failures: string[] = []

      checkEntryExportShape(runtimeEntry([], ['Foo']), failures, artifactRoot)

      expect(failures).toContainEqual(expect.stringContaining('module-link error TS2846'))
    })
  })

  it('rejects TypeScript-only syntax in emitted JavaScript', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(
        artifactRoot,
        'dist/index.mjs',
        'export type Hidden = true\nexport const expected = true\n',
      )
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export declare const expected: true\n')
      const failures: string[] = []

      checkEntryExportShape(runtimeEntry(['expected']), failures, artifactRoot)

      expect(failures).toContainEqual(expect.stringContaining('parse error(s): TS8008'))
    })
  })

  it('rejects invalid syntax in a transitive re-export', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', "export { expected } from './child.mjs'\n")
      writeArtifact(
        artifactRoot,
        'dist/child.mjs',
        'export type Hidden = true\nexport const expected = true\n',
      )
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export declare const expected: true\n')
      const failures: string[] = []

      checkEntryExportShape(runtimeEntry(['expected']), failures, artifactRoot)

      expect(failures).toContainEqual(expect.stringContaining('parse error(s): TS8008'))
    })
  })

  it('rejects malformed runtime and declaration syntax', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const value = true\n}\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export declare const value: true\n')
      const runtimeFailures: string[] = []

      checkEntryExportShape(runtimeEntry(['value']), runtimeFailures, artifactRoot)
      expect(runtimeFailures).toContainEqual(
        expect.stringMatching(/dist\/index\.mjs has TypeScript parse error\(s\): TS\d+/u),
      )

      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const value = true\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export interface Broken {\n')
      const declarationFailures: string[] = []

      checkEntryExportShape(runtimeEntry(['value']), declarationFailures, artifactRoot)
      expect(declarationFailures).toContainEqual(
        expect.stringMatching(/dist\/index\.d\.ts has TypeScript parse error\(s\): TS\d+/u),
      )
    })
  })
})
