import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

describe('package agent documentation', () => {
  it('rejects malformed canonical URLs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'better-convex-agent-docs-'))
    const packageRoot = join(directory, 'package')
    const sourceRoot = join(directory, 'source')
    mkdirSync(packageRoot)
    mkdirSync(sourceRoot)
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@lupinum/example',
        version: '1.0.0',
        exports: { './agent-docs': './dist/agent/AGENTS.md' },
      }),
    )
    writeFileSync(
      join(sourceRoot, 'start.md'),
      '---\ntitle: Start\nroute: /start\nurl: https://\n---\n',
    )

    try {
      const helper = pathToFileURL(resolve('scripts/package-agent-docs.mjs')).href
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import { buildPackageAgentDocs } from ${JSON.stringify(helper)}; await buildPackageAgentDocs(${JSON.stringify({ packageRoot, sourceRoot, startRoutes: ['/start'] })})`,
        ],
        { encoding: 'utf8' },
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('canonical URL')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects duplicate canonical URLs in a tampered installed inventory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'better-convex-agent-docs-'))
    const packageRoot = join(directory, 'package')
    const sourceRoot = join(directory, 'source')
    mkdirSync(packageRoot)
    mkdirSync(sourceRoot)
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@lupinum/example',
        version: '1.0.0',
        exports: { './agent-docs': './dist/agent/AGENTS.md' },
      }),
    )
    writeFileSync(
      join(sourceRoot, 'one.md'),
      '---\ntitle: One\nroute: /one\nurl: https://example.test/one\n---\n',
    )
    writeFileSync(
      join(sourceRoot, 'two.md'),
      '---\ntitle: Two\nroute: /two\nurl: https://example.test/two\n---\n',
    )

    try {
      const helper = pathToFileURL(resolve('scripts/package-agent-docs.mjs')).href
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import { createHash } from 'node:crypto'; import { readFile, writeFile } from 'node:fs/promises'; import { join } from 'node:path'; import { buildPackageAgentDocs, verifyPackageAgentDocs } from ${JSON.stringify(helper)}; const options = ${JSON.stringify({ packageRoot, sourceRoot, startRoutes: ['/one'] })}; await buildPackageAgentDocs(options); const root = join(options.packageRoot, 'dist/agent'); const pagePath = join(root, 'pages/two.md'); const page = (await readFile(pagePath, 'utf8')).replace('https://example.test/two', 'https://example.test/one'); await writeFile(pagePath, page); const manifestPath = join(root, 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); manifest.pages[1].url = manifest.pages[0].url; manifest.pages[1].sha256 = createHash('sha256').update(page).digest('hex'); await writeFile(manifestPath, JSON.stringify(manifest)); await verifyPackageAgentDocs(options.packageRoot);`,
        ],
        { encoding: 'utf8' },
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('differs from its inventory')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects duplicate installed starting routes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'better-convex-agent-docs-'))
    const packageRoot = join(directory, 'package')
    const sourceRoot = join(directory, 'source')
    mkdirSync(packageRoot)
    mkdirSync(sourceRoot)
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@lupinum/example',
        version: '1.0.0',
        exports: { './agent-docs': './dist/agent/AGENTS.md' },
      }),
    )
    writeFileSync(
      join(sourceRoot, 'start.md'),
      '---\ntitle: Start\nroute: /start\nurl: https://example.test/start\n---\n',
    )

    try {
      const helper = pathToFileURL(resolve('scripts/package-agent-docs.mjs')).href
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import { readFile, writeFile } from 'node:fs/promises'; import { join } from 'node:path'; import { buildPackageAgentDocs, verifyPackageAgentDocs } from ${JSON.stringify(helper)}; const options = ${JSON.stringify({ packageRoot, sourceRoot, startRoutes: ['/start'] })}; await buildPackageAgentDocs(options); const manifestPath = join(options.packageRoot, 'dist/agent/manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); manifest.startRoutes.push('/start'); await writeFile(manifestPath, JSON.stringify(manifest)); await verifyPackageAgentDocs(options.packageRoot);`,
        ],
        { encoding: 'utf8' },
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('starting routes must be unique')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
