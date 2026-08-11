import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkEntryPurity } from '../../scripts/package-check/purity.mjs'

function writeArtifact(artifactRoot: string, path: string, source: string) {
  const target = join(artifactRoot, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source)
}

function withArtifactRoot(run: (artifactRoot: string) => void) {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'bcn-entry-purity-'))
  try {
    run(artifactRoot)
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true })
  }
}

function runtimeEntry(
  runtimeExternalSpecifiers: string[] = [],
  typeExternalSpecifiers: string[] = [],
) {
  return {
    kind: 'runtime',
    subpath: './synthetic',
    distJs: 'dist/index.mjs',
    distDts: 'dist/index.d.ts',
    purity: {
      runtimeExternalSpecifiers,
      typeExternalSpecifiers,
    },
  }
}

describe('packed package entry purity', () => {
  it('accepts exact separate runtime and declaration allowlists through transitive local edges', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(
        artifactRoot,
        'dist/index.mjs',
        "import 'runtime-direct'\nexport * from './runtime-child.mjs'\n",
      )
      writeArtifact(
        artifactRoot,
        'dist/runtime-child.mjs',
        "import 'runtime-transitive'\nexport const child = true\n",
      )
      writeArtifact(
        artifactRoot,
        'dist/index.d.ts',
        "import type {} from 'types-direct'\nexport * from './types-child.js'\n",
      )
      writeArtifact(
        artifactRoot,
        'dist/types-child.d.ts',
        "import type {} from 'types-transitive'\nexport interface Child {}\n",
      )
      const failures: string[] = []

      checkEntryPurity(
        runtimeEntry(
          ['runtime-direct', 'runtime-transitive'],
          ['types-direct', 'types-transitive'],
        ),
        failures,
        artifactRoot,
      )

      expect(failures).toEqual([])
    })
  })

  it('rejects unreviewed runtime and declaration specifiers independently', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', "import 'unreviewed-runtime'\n")
      writeArtifact(artifactRoot, 'dist/index.d.ts', "import type {} from 'unreviewed-types'\n")
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)

      expect(failures).toEqual([
        '[./synthetic] runtime graph imports unreviewed external specifier "unreviewed-runtime"',
        '[./synthetic] types graph imports unreviewed external specifier "unreviewed-types"',
      ])
    })
  })

  it('rejects stale runtime and declaration allowances', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const value = true\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export declare const value: true\n')
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(['stale-runtime'], ['stale-types']), failures, artifactRoot)

      expect(failures).toEqual([
        '[./synthetic] runtime graph no longer imports reviewed external specifier "stale-runtime"; remove the stale allowance',
        '[./synthetic] types graph no longer imports reviewed external specifier "stale-types"; remove the stale allowance',
      ])
    })
  })

  it('rejects escaping and unresolved relative graph edges', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', "export * from '../../outside.mjs'\n")
      writeArtifact(artifactRoot, 'dist/index.d.ts', "export * from './missing.js'\n")
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)

      expect(failures).toEqual([
        '[./synthetic] dist/index.mjs has unresolved runtime edge "../../outside.mjs"',
        '[./synthetic] dist/index.d.ts has unresolved types edge "./missing.js"',
      ])
    })
  })

  it('rejects computed dynamic imports and CommonJS or indirect module loaders', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(
        artifactRoot,
        'dist/index.mjs',
        [
          "const target = './runtime-child.mjs'",
          'void import(target)',
          "require('direct-package')",
          "(require)('parenthesized-package')",
          "module.require('module-package')",
          "require.call(null, 'call-package')",
          "createRequire(import.meta.url)('created-package')",
          "process.getBuiltinModule('module')",
          "eval('void 0')",
          "new Function('return 1')",
          '',
        ].join('\n'),
      )
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export {}\n')
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)

      expect(failures).toEqual([
        '[./synthetic] runtime graph imports unreviewed external specifier "<computed dynamic import>"',
        '[./synthetic] runtime graph imports unreviewed external specifier "<unsupported module loader: require>"',
        '[./synthetic] runtime graph imports unreviewed external specifier "<unsupported module loader: createRequire>"',
        '[./synthetic] runtime graph imports unreviewed external specifier "<unsupported module loader: getBuiltinModule>"',
        '[./synthetic] runtime graph imports unreviewed external specifier "<unsupported module loader: eval>"',
        '[./synthetic] runtime graph imports unreviewed external specifier "<unsupported module loader: Function>"',
      ])
    })
  })

  it('rejects transitive CommonJS runtime files', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', "import './child.cjs'\n")
      writeArtifact(artifactRoot, 'dist/child.cjs', "require.call(null, 'hidden-package')\n")
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export {}\n')
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)

      expect(failures).toContain(
        '[./synthetic] dist/index.mjs has unresolved runtime edge "./child.cjs"',
      )
    })
  })

  it('does not apply bundler extension completion to public ESM entry graphs', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', "export { value } from './child'\n")
      writeArtifact(artifactRoot, 'dist/child.mjs', 'export const value = true\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export declare const value: true\n')
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)

      expect(failures).toContain(
        '[./synthetic] dist/index.mjs has unresolved runtime edge "./child"',
      )
    })
  })

  it('rejects non-canonical URL syntax in local ESM specifiers', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(
        artifactRoot,
        'dist/index.mjs',
        "export { value } from './child%2fescape.mjs'\n",
      )
      writeArtifact(artifactRoot, 'dist/child%2fescape.mjs', 'export const value = true\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', 'export declare const value: true\n')
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)

      expect(failures).toContain(
        '[./synthetic] dist/index.mjs has unresolved runtime edge "./child%2fescape.mjs"',
      )
    })
  })

  it('checks a types-only entry without requiring a JavaScript artifact', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(
        artifactRoot,
        'dist/component.d.ts',
        "import type {} from 'convex/server'\nexport interface ComponentApi {}\n",
      )
      const failures: string[] = []

      checkEntryPurity(
        {
          kind: 'types-only',
          subpath: './component.js',
          distDts: 'dist/component.d.ts',
          purity: {
            runtimeExternalSpecifiers: [],
            typeExternalSpecifiers: ['convex/server'],
          },
        },
        failures,
        artifactRoot,
      )

      expect(failures).toEqual([])
    })
  })

  it('treats triple-slash type packages as exact external declaration dependencies', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const value = true\n')
      writeArtifact(
        artifactRoot,
        'dist/index.d.ts',
        '/// <reference types="unreviewed-types" />\nexport declare const value: true\n',
      )
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)
      expect(failures).toContain(
        '[./synthetic] types graph imports unreviewed external specifier "unreviewed-types"',
      )

      failures.length = 0
      checkEntryPurity(runtimeEntry([], ['unreviewed-types']), failures, artifactRoot)
      expect(failures).toEqual([])
    })
  })

  it('follows triple-slash path references through the declaration graph', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const value = true\n')
      writeArtifact(
        artifactRoot,
        'dist/index.d.ts',
        '/// <reference path="types-child.d.ts" />\nexport declare const value: true\n',
      )
      writeArtifact(
        artifactRoot,
        'dist/types-child.d.ts',
        '/// <reference types="transitive-types" />\nexport interface Child {}\n',
      )
      const failures: string[] = []

      checkEntryPurity(runtimeEntry([], ['transitive-types']), failures, artifactRoot)

      expect(failures).toEqual([])
    })
  })

  it('rejects empty and directory-index triple-slash reference paths', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const value = true\n')
      writeArtifact(
        artifactRoot,
        'dist/index.d.ts',
        '/// <reference path="" />\n/// <reference path="./folder" />\n/// <reference path="./child.js" />\nexport declare const value: true\n',
      )
      writeArtifact(artifactRoot, 'dist/folder/index.d.ts', 'export interface Hidden {}\n')
      writeArtifact(artifactRoot, 'dist/child.d.ts', 'export interface Child {}\n')
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)

      expect(failures).toContain(
        '[./synthetic] dist/index.d.ts has unresolved types reference path ""',
      )
      expect(failures).toContain(
        '[./synthetic] dist/index.d.ts has unresolved types reference path "./folder"',
      )
      expect(failures).toContain(
        '[./synthetic] dist/index.d.ts has unresolved types reference path "./child.js"',
      )
    })
  })

  it('maps explicit JavaScript extensions to the matching declaration module kind', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const value = true\n')
      writeArtifact(artifactRoot, 'dist/index.d.mts', "export * from './types-child.mjs'\n")
      writeArtifact(
        artifactRoot,
        'dist/types-child.d.ts',
        "import type {} from 'wrong-declaration'\n",
      )
      writeArtifact(
        artifactRoot,
        'dist/types-child.d.mts',
        "import type {} from 'right-declaration'\n",
      )
      const failures: string[] = []

      checkEntryPurity(
        {
          ...runtimeEntry([], ['right-declaration']),
          distDts: 'dist/index.d.mts',
        },
        failures,
        artifactRoot,
      )

      expect(failures).toEqual([])
    })
  })

  it('accepts installed compiler lib references and rejects path-like or unknown names', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const value = true\n')
      writeArtifact(
        artifactRoot,
        'dist/index.d.ts',
        '/// <reference lib="es2022" />\n/// <reference lib="../unreviewed" />\n/// <reference lib="totally-fake" />\nexport declare const value: true\n',
      )
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)

      expect(failures).toContain(
        '[./synthetic] dist/index.d.ts has unknown TypeScript lib reference "../unreviewed"',
      )
      expect(failures).toContain(
        '[./synthetic] dist/index.d.ts has unknown TypeScript lib reference "totally-fake"',
      )
      expect(failures).not.toContainEqual(expect.stringContaining('es2022'))
    })
  })

  it('rejects malformed entry and transitive graph artifacts', () => {
    withArtifactRoot((artifactRoot) => {
      writeArtifact(artifactRoot, 'dist/index.mjs', 'export const value = true\n}\n')
      writeArtifact(artifactRoot, 'dist/index.d.ts', "export * from './types-child.js'\n")
      writeArtifact(artifactRoot, 'dist/types-child.d.ts', 'export interface Child {\n')
      const failures: string[] = []

      checkEntryPurity(runtimeEntry(), failures, artifactRoot)

      expect(failures).toContainEqual(
        expect.stringMatching(/dist\/index\.mjs has TypeScript parse error\(s\): TS\d+/u),
      )
      expect(failures).toContainEqual(
        expect.stringMatching(/dist\/types-child\.d\.ts has TypeScript parse error\(s\): TS\d+/u),
      )
    })
  })
})
