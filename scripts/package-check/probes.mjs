// Packed consumer probes
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  requiredPhysicalRuntimeNames,
  requiredStatefulPeerNames,
  supportedDependencyTuple,
} from '../supported-dependency-tuple.mjs'

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  })
}

function installStrict(cwd, { production = false } = {}) {
  run(
    'pnpm',
    [
      'install',
      ...(production ? ['--prod'] : []),
      '--no-frozen-lockfile',
      '--ignore-scripts',
      '--strict-peer-dependencies',
    ],
    { cwd },
  )
}

function productionGraph(directory) {
  return JSON.parse(
    execFileSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], {
      cwd: directory,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  )
}

function collectDependencyInstances(graph) {
  const instances = new Map()
  const visit = (node) => {
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const [name, dependency] of Object.entries(node?.[section] ?? {})) {
        if (!dependency || typeof dependency !== 'object') continue
        const records = instances.get(name) ?? []
        records.push({ path: dependency.path, version: dependency.version })
        instances.set(name, records)
        visit(dependency)
      }
    }
  }
  for (const root of graph) visit(root)
  return instances
}

function assertProductionGraph(directory, expectedRuntimeNames, label) {
  const instances = collectDependencyInstances(productionGraph(directory))
  for (const name of expectedRuntimeNames) {
    const records = instances.get(name) ?? []
    const paths = new Set(records.map((record) => record.path).filter(Boolean))
    const versions = new Set(records.map((record) => record.version).filter(Boolean))
    if (paths.size !== 1 || versions.size !== 1 || !versions.has(supportedDependencyTuple[name])) {
      throw new Error(
        `${label} must resolve one physical ${name}@${supportedDependencyTuple[name]}; received ${JSON.stringify([...records])}`,
      )
    }
  }
  for (const name of instances.keys()) {
    if (
      name === 'react' ||
      name === 'react-dom' ||
      name === 'next' ||
      name.startsWith('@tanstack/')
    ) {
      throw new Error(`${label} unexpectedly installs production framework package ${name}`)
    }
  }
}

// ---------------------------------------------------------------------------

/** @typedef {{ filename: string, packageName: string, tarballPath: string, version: string }} CompanionTarball */
/** @typedef {{ packageName: string, repositoryRoot: string, packageManifest: object, tarballPath: string, companionTarballs: CompanionTarball[], failures: string[] }} ProbeContext */

function companionDependencies(ctx) {
  return Object.fromEntries(
    ctx.companionTarballs.map((companion) => [
      companion.packageName,
      `file:${companion.tarballPath}`,
    ]),
  )
}

function prepareFixtureTarballs(ctx, fixtureDir) {
  const workspacePath = join(fixtureDir, 'pnpm-workspace.yaml')
  const originalWorkspace = readFileSync(workspacePath, 'utf8')
  const copiedTarballs = []
  const rules = []

  for (const companion of ctx.companionTarballs) {
    if (originalWorkspace.includes(`${companion.packageName}:`)) {
      throw new Error(`Fixture already controls ${companion.packageName} resolution.`)
    }
    const localTarball = join(fixtureDir, companion.filename)
    copyFileSync(companion.tarballPath, localTarball)
    copiedTarballs.push(localTarball)
    rules.push(`  '${companion.packageName}': 'file:./${companion.filename}'`)
  }

  if (rules.length > 0) {
    writeFileSync(
      workspacePath,
      `${originalWorkspace}${originalWorkspace.endsWith('\n') ? '' : '\n'}overrides:\n${rules.join('\n')}\n`,
    )
  }

  return () => {
    writeFileSync(workspacePath, originalWorkspace)
    for (const tarball of copiedTarballs) rmSync(tarball, { force: true })
  }
}

/**
 * Package-root probe: an ephemeral (non-repo, non-committed) consumer that
 * installs the packed tarball and proves runtime and type resolution for the
 * root module plus the Convex auth barrel/config, and type resolution for the
 * compiled test helper and intentionally type-only generated component entry.
 * No dedicated fixture directory is required.
 */
export function probeRootEntry(ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'bcn-root-probe-'))

  const consumerPeers = ctx.packageManifest.peerDependencies

  writeJson(join(dir, 'package.json'), {
    name: 'root-entry-probe',
    private: true,
    type: 'module',
    packageManager: ctx.packageManifest.packageManager,
    dependencies: {
      ...consumerPeers,
      ...companionDependencies(ctx),
      [ctx.packageName]: `file:${ctx.tarballPath}`,
    },
    devDependencies: {
      typescript: ctx.packageManifest.devDependencies.typescript,
      '@types/node': ctx.packageManifest.devDependencies['@types/node'],
    },
  })
  writeFile(join(dir, '.npmrc'), 'ignore-scripts=true\n')
  const companionOverrides = ctx.companionTarballs
    .map((companion) => `  '${companion.packageName}': 'file:${companion.tarballPath}'`)
    .join('\n')
  writeFile(
    join(dir, 'pnpm-workspace.yaml'),
    [
      '# isolated root for the ephemeral packed-root probe',
      ...(companionOverrides ? ['overrides:', companionOverrides] : []),
      '',
    ].join('\n'),
  )
  writeFile(
    join(dir, 'index.mjs'),
    [
      "import { realpathSync } from 'node:fs'",
      "import { createRequire } from 'node:module'",
      `import mod from '${ctx.packageName}'`,
      `import authComponent from '${ctx.packageName}/convex-auth/convex.config'`,
      'import {',
      '  convexAuth, createAuthComponent, defineAuthAdapterFunctions,',
      '  getConvexAuthProvider, requireAuthOrigin, verifyOAuthBearerToken,',
      `} from '${ctx.packageName}/convex-auth'`,
      "if (typeof mod !== 'function' && typeof mod !== 'object') throw new Error('default export did not resolve')",
      "if (!authComponent || (typeof authComponent !== 'function' && typeof authComponent !== 'object')) throw new Error('auth component config did not resolve')",
      'for (const [name, value] of Object.entries({',
      '  convexAuth, createAuthComponent, defineAuthAdapterFunctions,',
      '  getConvexAuthProvider, requireAuthOrigin, verifyOAuthBearerToken,',
      '})) {',
      "  if (typeof value !== 'function') throw new Error(`auth export did not resolve: ${name}`)",
      '}',
      '',
      '// Better Auth and Convex are stateful peer runtimes. The package and its',
      '// consumer must resolve the same physical instance of each.',
      'const consumerRequire = createRequire(import.meta.url)',
      `const libraryRequire = createRequire(new URL(import.meta.resolve('${ctx.packageName}')))`,
      `for (const peer of ${JSON.stringify(requiredStatefulPeerNames)}) {`,
      '  const consumerPath = realpathSync(consumerRequire.resolve(peer))',
      '  const libraryPath = realpathSync(libraryRequire.resolve(peer))',
      '  if (consumerPath !== libraryPath) {',
      '    throw new Error(`duplicate stateful peer runtime: ${peer}`)',
      '  }',
      '}',
      '',
      "console.log('root-entry-probe runtime OK')",
      '',
    ].join('\n'),
  )
  writeFile(
    join(dir, 'schema-options.ts'),
    [
      "import type { BetterAuthOptions } from 'better-auth'",
      '',
      'export default {',
      "  baseURL: 'https://schema.invalid',",
      "  secret: 'schema-generation-only-value-never-used-at-runtime',",
      '} satisfies BetterAuthOptions',
      '',
    ].join('\n'),
  )
  writeFile(
    join(dir, 'index.ts'),
    [
      'import type {',
      '  BaseAuthClient, ConvexAuthMode, ConvexAuthOptions, ConvexAuthClientRegistry,',
      '  ConvexAuthStatus, ConvexCallErrorKind, ConvexCallStatus, ConvexClientHandle, ConvexRuntimeConfig,',
      '  InferRegisteredConvexAuthClient, ModuleOptions, OptimisticUpdate, ServerConvexOptions,',
      '  UploadProgressInfo, UploadStatus, UploadUrlMutation, UseConvexAuthReturn,',
      '  UseConvexCall, UseConvexFileUploadOptions, UseConvexFileUploadReturn, UseConvexMutationOptions,',
      '  UseConvexPaginatedQueryOptions,',
      '  UseConvexQueryOptions,',
      `} from '${ctx.packageName}'`,
      'import type {',
      '  AuthComponentTriggers, AuthCtx, AuthFunctions, CreateAuth, VerifyOAuthBearerTokenOptions,',
      `} from '${ctx.packageName}/convex-auth'`,
      `import authComponent from '${ctx.packageName}/convex-auth/convex.config'`,
      `import type { ComponentApi } from '${ctx.packageName}/convex-auth/_generated/component.js'`,
      `import authTest, { register } from '${ctx.packageName}/convex-auth/test'`,
      `import mod from '${ctx.packageName}'`,
      '',
      'const _opts: ModuleOptions | undefined = undefined',
      'type PublicContract = [',
      '  BaseAuthClient, ConvexAuthMode, ConvexAuthOptions, ConvexAuthClientRegistry,',
      '  ConvexAuthStatus, ConvexCallErrorKind, ConvexCallStatus, ConvexClientHandle, ConvexRuntimeConfig,',
      '  InferRegisteredConvexAuthClient, OptimisticUpdate<never>, ServerConvexOptions, UseConvexAuthReturn,',
      '  UploadProgressInfo, UploadStatus, UploadUrlMutation, UseConvexFileUploadOptions,',
      '  UseConvexCall<never>, UseConvexFileUploadReturn<UploadUrlMutation>, UseConvexMutationOptions<never>,',
      '  UseConvexPaginatedQueryOptions, UseConvexQueryOptions<unknown>,',
      '  AuthComponentTriggers, AuthCtx, AuthFunctions, CreateAuth, VerifyOAuthBearerTokenOptions, ComponentApi,',
      ']',
      'const _contract: PublicContract | undefined = undefined',
      'void mod',
      'void authComponent',
      'void authTest',
      'void register',
      'void _opts',
      'void _contract',
      '',
    ].join('\n'),
  )
  // The root default export drags in the module-build/Nuxt/Nitro type graph
  // (`@nuxt/schema`, `nitropack`, transitively `nuxt`). Real consumers
  // typecheck that graph with `skipLibCheck: true` and bundler resolution —
  // Nuxt's own generated tsconfig does the same — so this probe matches that
  // real-world configuration rather than an artificially strict one that
  // would fail on upstream declaration quirks unrelated to this package.
  writeJson(join(dir, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ['node'],
    },
    include: ['index.ts'],
  })

  try {
    installStrict(dir, { production: true })
    run('node', ['index.mjs'], { cwd: dir })
    assertProductionGraph(dir, requiredPhysicalRuntimeNames, 'production consumer')
    if (process.env.BCN_RELEASE_PRODUCTION_AUDIT === 'true') {
      run(
        'node',
        [join(ctx.repositoryRoot, 'scripts/check-auth-advisories.mjs'), '--production-dir', dir],
        {
          cwd: ctx.repositoryRoot,
        },
      )
    }

    installStrict(dir)
    run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: dir })
    run(
      'pnpm',
      [
        'exec',
        'better-convex-nuxt-auth-schema',
        '--config',
        'schema-options.ts',
        '--output',
        'convex/betterAuth',
      ],
      { cwd: dir },
    )
    run(
      'pnpm',
      [
        'exec',
        'better-convex-nuxt-auth-schema',
        '--config',
        'schema-options.ts',
        '--output',
        'convex/betterAuth',
        '--check',
      ],
      { cwd: dir },
    )
    const convexHelp = run('pnpm', ['exec', 'better-convex-nuxt-convex', '--help'], {
      cwd: dir,
      stdio: 'pipe',
    })
    if (!convexHelp.includes('Usage:')) throw new Error('packed Convex CLI did not execute')
  } catch (error) {
    ctx.failures.push(`[.] packed root-entry probe failed: ${error.message}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * `/errors` probe: installs the packed tarball into the committed
 * `test/fixtures/errors-consumer` fixture and runs
 * its `build` (type resolution via `tsc`) and `start` (runtime resolution +
 * behavioral assertions) scripts.
 */
export function probeErrorsEntry(ctx) {
  const fixtureDir = resolve(ctx.repositoryRoot, 'test/fixtures/errors-consumer')
  const localTarball = join(fixtureDir, 'better-convex-nuxt.tgz')
  copyFileSync(ctx.tarballPath, localTarball)
  const restoreFixture = prepareFixtureTarballs(ctx, fixtureDir)

  try {
    installStrict(fixtureDir)
    run('pnpm', ['run', 'build'], { cwd: fixtureDir })
    run('pnpm', ['run', 'start'], { cwd: fixtureDir })
  } catch (error) {
    ctx.failures.push(`[./errors] packed errors-consumer probe failed: ${error.message}`)
  } finally {
    rmSync(join(fixtureDir, 'node_modules'), { recursive: true, force: true })
    rmSync(join(fixtureDir, 'dist'), { recursive: true, force: true })
    rmSync(localTarball, { force: true })
    rmSync(join(fixtureDir, 'pnpm-lock.yaml'), { force: true })
    restoreFixture()
  }
}

/**
 * `/auth-client` probe. Installs the
 * packed tarball into the committed `test/fixtures/auth-client-typing` fixture
 * so the module and consumer share ONE `better-auth` copy, then:
 *   - `nuxi prepare` generates the REAL registry declaration from the fixture's
 *     `convex-auth.ts` (apiKeyClient) definition;
 *   - `nuxi typecheck` proves the narrowed `InferRegisteredConvexAuthClient`
 *     exposes a typed `apiKey.create` method;
 *   - `tsc` over the separate `base-fallback` program proves the empty-fallback
 *     registration exposes only the base client, with no `apiKey` method.
 */
export function probeAuthClientTyping(ctx) {
  const fixtureDir = resolve(ctx.repositoryRoot, 'test/fixtures/auth-client-typing')
  const localTarball = join(fixtureDir, 'better-convex-nuxt.tgz')
  copyFileSync(ctx.tarballPath, localTarball)
  const restoreFixture = prepareFixtureTarballs(ctx, fixtureDir)

  try {
    installStrict(fixtureDir)
    run('pnpm', ['run', 'prepare:types'], { cwd: fixtureDir })
    run('pnpm', ['run', 'typecheck'], { cwd: fixtureDir })
    run('pnpm', ['run', 'typecheck:base-fallback'], { cwd: fixtureDir })
  } catch (error) {
    ctx.failures.push(`[./auth-client] packed auth-client-typing probe failed: ${error.message}`)
  } finally {
    rmSync(join(fixtureDir, 'node_modules'), { recursive: true, force: true })
    rmSync(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
    rmSync(join(fixtureDir, '.output'), { recursive: true, force: true })
    rmSync(localTarball, { force: true })
    rmSync(join(fixtureDir, 'pnpm-lock.yaml'), { force: true })
    restoreFixture()
  }
}

/**
 * `/server` probe: installs the packed tarball into the committed
 * `test/fixtures/server-consumer` fixture and runs typechecking plus a
 * production Nitro lifecycle against a deterministic local Convex-protocol
 * server. This proves the real `better-convex-nuxt/server` subpath resolves
 * from the packed package and preserves query/mutation/action error boundaries.
 */
export function probeServerEntry(ctx) {
  const fixtureDir = resolve(ctx.repositoryRoot, 'test/fixtures/server-consumer')
  const localTarball = join(fixtureDir, 'better-convex-nuxt.tgz')
  copyFileSync(ctx.tarballPath, localTarball)
  const restoreFixture = prepareFixtureTarballs(ctx, fixtureDir)

  try {
    installStrict(fixtureDir)
    run('pnpm', ['run', 'prepare:types'], { cwd: fixtureDir })
    run('pnpm', ['run', 'typecheck'], { cwd: fixtureDir })
    run('pnpm', ['run', 'probe:production'], { cwd: fixtureDir })
    run(
      'node',
      [
        '--input-type=module',
        '--eval',
        `const server = await import('${ctx.packageName}/server'); if (typeof server.serverConvex !== 'function') process.exit(1)`,
      ],
      { cwd: fixtureDir },
    )
  } catch (error) {
    ctx.failures.push(`[./server] packed server-consumer probe failed: ${error.message}`)
  } finally {
    rmSync(join(fixtureDir, 'node_modules'), { recursive: true, force: true })
    rmSync(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
    rmSync(join(fixtureDir, '.output'), { recursive: true, force: true })
    rmSync(localTarball, { force: true })
    rmSync(join(fixtureDir, 'pnpm-lock.yaml'), { force: true })
    restoreFixture()
  }
}

/**
 * `/server/createUserSyncTriggers` probe: this entry is framework-free (no
 * Nuxt/H3/Convex import of its own), so — like `/errors` — it is proved with
 * a standalone Node consumer rather than a full Nuxt fixture: installs the
 * packed tarball into `test/fixtures/user-sync-triggers-consumer` and runs its
 * `build` (type resolution via `tsc`) and `start` (runtime resolution).
 */
export function probeCreateUserSyncTriggersEntry(ctx) {
  const fixtureDir = resolve(ctx.repositoryRoot, 'test/fixtures/user-sync-triggers-consumer')
  const localTarball = join(fixtureDir, 'better-convex-nuxt.tgz')
  copyFileSync(ctx.tarballPath, localTarball)
  const restoreFixture = prepareFixtureTarballs(ctx, fixtureDir)

  try {
    installStrict(fixtureDir)
    run('pnpm', ['run', 'build'], { cwd: fixtureDir })
    run('pnpm', ['run', 'start'], { cwd: fixtureDir })
  } catch (error) {
    ctx.failures.push(
      `[./server/createUserSyncTriggers] packed user-sync-triggers-consumer probe failed: ${error.message}`,
    )
  } finally {
    rmSync(join(fixtureDir, 'node_modules'), { recursive: true, force: true })
    rmSync(join(fixtureDir, 'dist'), { recursive: true, force: true })
    rmSync(localTarball, { force: true })
    rmSync(join(fixtureDir, 'pnpm-lock.yaml'), { force: true })
    restoreFixture()
  }
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
