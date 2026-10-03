import { readFileSync } from 'node:fs'

/** Only missing Better Auth packages get an install hint; other import failures keep their cause. */
export function rethrowAuthSchemaImportError(error: unknown): never {
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_MODULE_NOT_FOUND' &&
    /^Cannot find package '(?:better-auth|@better-auth\/[^']+)' imported from /u.test(error.message)
  ) {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { peerDependencies: Record<string, string> }
    const packages = ['better-auth', '@better-auth/core', '@better-auth/oauth-provider']
    const install = packages.map((name) => `${name}@${manifest.peerDependencies[name]}`).join(' ')
    throw new Error(
      `better-convex auth schema needs the optional Better Auth packages. Install them with: pnpm add ${install}`,
      { cause: error },
    )
  }
  throw error
}
