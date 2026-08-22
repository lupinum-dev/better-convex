import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAuthTables } from 'better-auth/db'
import { describe, expect, it } from 'vitest'

import { generateAuthSchemaArtifacts } from '../../src/runtime/convex-auth/adapter/generate-schema'
import schemaOptions from '../fixtures/better-auth-two-factor/convex/betterAuth/schemaOptions'

const root = join(import.meta.dirname, '../..')
const fixture = 'test/fixtures/better-auth-two-factor/convex'
const removedAuthPackage = ['@convex-dev', 'better-auth'].join('/')

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('dedicated Better Auth two-factor fixture', () => {
  it('compiles against the one exact supported Better Auth and Convex tuple', () => {
    const manifest = JSON.parse(
      read('test/fixtures/better-auth-two-factor/package.json'),
    ) as Record<string, unknown>
    expect(manifest.peerDependencies).toEqual({
      '@better-auth/oauth-provider': '1.7.0-rc.2',
      'better-auth': '1.7.0-rc.2',
      convex: '1.42.2',
    })
  })

  it('uses one generated local schema and the shared BCN adapter implementation', () => {
    const adapter = read(`${fixture}/betterAuth/adapter.ts`)
    const runtime = read(`${fixture}/auth.ts`)
    const schemaInput = read(`${fixture}/betterAuth/schemaOptions.ts`)

    expect(adapter).toContain(
      "import { defineAuthAdapterFunctions } from '@lupinum/better-convex-nuxt/better-auth/server'",
    )
    expect(adapter).toContain('defineAuthAdapterFunctions({ metadata: schemaMetadata, schema })')
    expect(adapter).not.toMatch(/function\s+(?:findOne|create|incrementOne)\s*\(/)
    expect(runtime).toContain('...createTwoFactorAuthPlugins(authIssuer)')
    expect(runtime).toContain('authComponent.jwksOperatorFunctions(createAuth)')
    expect(runtime).toContain('authConfig: { providers: [getConvexAuthProvider()] }')
    expect(runtime).not.toContain("import authConfig from './auth.config'")
    expect(schemaInput).toContain('plugins: createTwoFactorAuthPlugins(authIssuer)')
    expect(runtime).not.toContain(removedAuthPackage)
    expect(schemaInput).not.toContain(removedAuthPackage)
  })

  it('keeps the checked-in two-factor schema and metadata on the canonical generator', () => {
    const generated = generateAuthSchemaArtifacts(getAuthTables(schemaOptions))
    const schema = read(`${fixture}/betterAuth/schema.ts`)
    const metadata = read(`${fixture}/betterAuth/schemaMetadata.ts`)

    expect(schema).toContain(`value: '${generated.metadata.fingerprint}'`)
    expect(metadata).toContain(`fingerprint: '${generated.metadata.fingerprint}'`)
    expect(generated.metadata.models.twoFactor).toMatchObject({
      logicalName: 'twoFactor',
      fields: {
        failedVerificationCount: { kind: 'number', nullable: true },
        lockedUntil: { kind: 'date', nullable: true },
        userId: { kind: 'string', nullable: false },
      },
    })
    expect(generated.metadata.models.user?.fields.twoFactorEnabled).toMatchObject({
      kind: 'boolean',
      nullable: true,
    })
    expect(generated.metadata.models.verification?.indexes).toContainEqual({
      descriptor: 'identifier_createdAt',
      fields: ['identifier', 'createdAt'],
    })
  })

  it('hard-disables generic JWT minting and every automatic Convex JWT side channel', () => {
    const runtime = read(`${fixture}/auth.ts`)
    const plugins = read(`${fixture}/betterAuth/schemaPlugins.ts`)
    const allFixtureSource = [
      runtime,
      plugins,
      read(`${fixture}/http.ts`),
      read(`${fixture}/fixtureControl.ts`),
    ].join('\n')

    expect(runtime).toMatch(/disabledPaths:\s*\[\s*'\/token'/)
    expect(plugins).toContain('disableSettingJwtHeader: true')
    expect(runtime).toContain('convexAuth({')
    expect(runtime).toContain("audience: 'convex'")
    expect(runtime).toContain("expirationTime: '15m'")
    expect(runtime).toContain('cookieCache: { enabled: true')
    expect(allFixtureSource).not.toContain('convex_jwt')
    expect(allFixtureSource).not.toContain('set-auth-jwt')
    expect(allFixtureSource).not.toContain('newSession')
  })

  it('keeps persisted-state fault controls test-only, proof-gated, and unable to mint', () => {
    const control = read(`${fixture}/fixtureControl.ts`)

    expect(control).toContain('MFA_FIXTURE_CONTROL_DENIED')
    expect(control).toContain('MFA_FIXTURE_SIGNING_KEY_PROVISIONING_INVALID')
    expect(control).toContain("'auth:rotateSigningKey'")
    expect(control).toContain('process.env.BCN_AUTH_PROXY_IP_SECRET')
    expect(control).toContain('components.betterAuth.adapter.updateOne')
    expect(control).toContain('components.betterAuth.adapter.deleteOne')
    expect(control).not.toContain('convex/token')
    expect(control).not.toContain('signJWT')
    expect(control).not.toContain('privateKey')
  })

  it('leaves the local backend-owned CONVEX_SITE_URL environment variable untouched', () => {
    const harness = read('test/helpers/local-convex.ts')

    expect(harness).not.toMatch(/setLocalConvexEnvironment\(\s*cwd,\s*['"]CONVEX_SITE_URL['"]/u)
    expect(harness).toContain('CONVEX_SITE_URL is supplied by the selected Convex deployment')
    expect(harness).toContain('OptimisticConcurrencyControlFailure')
    expect(harness).toContain("'Captured Convex output:'")
    expect(harness).toContain('child.stdin.end(`${value}\\n`)')
    expect(harness).not.toContain("['env', 'set', name, value")
  })
})
