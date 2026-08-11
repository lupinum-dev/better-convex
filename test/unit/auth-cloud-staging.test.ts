import { spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertCloudArtifactFamily,
  assertCloudRuntimeFingerprint,
  assertCloudRouteFingerprint,
  assertInstalledArtifactFingerprint,
  assertSingleBetterAuthMount,
  bindCloudFixtureArtifacts,
  normalizeAuthorizationCodeEvidence,
  normalizeCloudPrewriteProof,
  parseCloudArtifactArguments,
  parseCloudStagingEnvironment,
  parseConvexDeploymentDescription,
  verifyCloudSessionToken,
} from '../../scripts/run-auth-cloud-staging.mjs'
import packagedSchemaMetadata from '../../src/runtime/convex-auth/component/schemaMetadata'

const deploymentName = 'gentle-squid-123'
const convexUrl = `https://${deploymentName}.convex.cloud`
const root = resolve(import.meta.dirname, '../..')
const reportPath = resolve(root, '.release-artifacts/bcn-auth-staging.report.json')
const runtimeFingerprint = `bcn-release-v1-${'a'.repeat(64)}`
const invalidArtifactArguments = [
  '--artifact-manifest',
  'does-not-exist.nuxt.artifact.json',
  '--vue-artifact-manifest',
  'does-not-exist.vue.artifact.json',
  '--mcp-artifact-manifest',
  'does-not-exist.mcp.artifact.json',
]

function stagingEnvironment(overrides: Record<string, string> = {}) {
  return {
    BCN_AUTH_STAGING_CONVEX_SITE_URL: `https://${deploymentName}.convex.site`,
    BCN_AUTH_STAGING_CONVEX_URL: convexUrl,
    BCN_AUTH_STAGING_EMAIL: 'staging-owner@example.test',
    BCN_AUTH_STAGING_INGRESS_LEASE: 'a'.repeat(43),
    BCN_AUTH_STAGING_ORIGIN: 'https://auth-staging.example.test',
    BCN_AUTH_STAGING_PASSWORD: 'correct horse battery staple',
    BCN_AUTH_STAGING_TEAM: 'better-convex',
    CONVEX_DEPLOY_KEY: `prod:${deploymentName}|${'x'.repeat(48)}`,
    ...overrides,
  }
}

function deploymentDescription(
  overrides: Partial<Record<'deployment' | 'project' | 'team' | 'type' | 'url', string>> = {},
) {
  return `Currently configured deployment:
  URL: ${overrides.url ?? convexUrl}
  Deployment: ${overrides.deployment ?? deploymentName} (${overrides.type ?? 'prod'})
  Team: ${overrides.team ?? 'better-convex'}
  Project: ${overrides.project ?? 'bcn-auth-staging'}
`
}

describe('protected cloud-staging gate', () => {
  it('accepts only a deployment-scoped production key and matching HTTPS topology', () => {
    const value = parseCloudStagingEnvironment(stagingEnvironment())
    expect(value).toMatchObject({
      convexSiteUrl: `https://${deploymentName}.convex.site`,
      convexUrl,
      deploymentName,
      ingressCookie: `__Host-bcn-staging-lease=${'a'.repeat(43)}`,
      origin: 'https://auth-staging.example.test',
      team: 'better-convex',
    })

    expect(
      parseCloudStagingEnvironment(
        stagingEnvironment({
          BCN_AUTH_STAGING_CONVEX_SITE_URL: `https://${deploymentName}.eu-west-1.convex.site`,
          BCN_AUTH_STAGING_CONVEX_URL: `https://${deploymentName}.eu-west-1.convex.cloud`,
        }),
      ),
    ).toMatchObject({
      convexSiteUrl: `https://${deploymentName}.eu-west-1.convex.site`,
      convexUrl: `https://${deploymentName}.eu-west-1.convex.cloud`,
    })

    expect(() =>
      parseCloudStagingEnvironment(
        stagingEnvironment({ CONVEX_DEPLOY_KEY: `dev:${deploymentName}|${'x'.repeat(48)}` }),
      ),
    ).toThrow('AUTH_CLOUD_STAGING_DEPLOY_KEY_INVALID')
    expect(() =>
      parseCloudStagingEnvironment(
        stagingEnvironment({
          CONVEX_DEPLOY_KEY: `project:better-convex:bcn-auth-staging|${'x'.repeat(48)}`,
        }),
      ),
    ).toThrow('AUTH_CLOUD_STAGING_DEPLOY_KEY_INVALID')
    expect(() =>
      parseCloudStagingEnvironment(
        stagingEnvironment({
          BCN_AUTH_STAGING_CONVEX_URL: 'https://different-deployment.convex.cloud',
        }),
      ),
    ).toThrow('AUTH_CLOUD_STAGING_CONVEX_URL_MISMATCH')
    expect(() =>
      parseCloudStagingEnvironment(
        stagingEnvironment({
          BCN_AUTH_STAGING_CONVEX_SITE_URL: `https://${deploymentName}.other.convex.site`,
        }),
      ),
    ).toThrow('AUTH_CLOUD_STAGING_CONVEX_SITE_URL_MISMATCH')
    expect(() =>
      parseCloudStagingEnvironment({
        ...stagingEnvironment(),
        BCN_AUTH_STAGING_ORIGIN: 'http://auth-staging.example.test',
      }),
    ).toThrow('AUTH_CLOUD_STAGING_ORIGIN_INVALID')
    expect(() =>
      parseCloudStagingEnvironment(
        stagingEnvironment({ BCN_AUTH_STAGING_INGRESS_LEASE: 'too-short' }),
      ),
    ).toThrow('AUTH_CLOUD_STAGING_INGRESS_LEASE_INVALID')
  })

  it('binds the deployment key to the named Convex project and production deployment', () => {
    const expected = parseCloudStagingEnvironment(stagingEnvironment())
    expect(parseConvexDeploymentDescription(deploymentDescription(), expected)).toEqual({
      deploymentName,
      project: 'bcn-auth-staging',
      team: 'better-convex',
      type: 'prod',
    })

    expect(() =>
      parseConvexDeploymentDescription(
        deploymentDescription({ project: 'some-other-project' }),
        expected,
      ),
    ).toThrow('AUTH_CLOUD_STAGING_PROJECT_MISMATCH')
    expect(() =>
      parseConvexDeploymentDescription(deploymentDescription({ type: 'dev' }), expected),
    ).toThrow('AUTH_CLOUD_STAGING_DEPLOYMENT_MISMATCH')
    expect(() =>
      parseConvexDeploymentDescription(deploymentDescription({ team: 'wrong-team' }), expected),
    ).toThrow('AUTH_CLOUD_STAGING_TEAM_MISMATCH')
    expect(() =>
      parseConvexDeploymentDescription(
        `${deploymentDescription()}  Project: bcn-auth-staging\n`,
        expected,
      ),
    ).toThrow('AUTH_CLOUD_STAGING_PROJECT_MISSING')
  })

  it('requires the exact build-generated public-origin fingerprint', () => {
    const artifact = { runtimeFingerprint }
    expect(assertCloudRuntimeFingerprint({ runtimeFingerprint, schemaVersion: 1 }, artifact)).toBe(
      true,
    )
    expect(() =>
      assertCloudRuntimeFingerprint(
        { runtimeFingerprint: `bcn-release-v1-${'b'.repeat(64)}`, schemaVersion: 1 },
        artifact,
      ),
    ).toThrow('AUTH_CLOUD_STAGING_RUNTIME_FINGERPRINT_MISMATCH')
    expect(() =>
      assertCloudRuntimeFingerprint(
        { runtimeFingerprint, schemaVersion: 1, operatorClaim: 'matched' },
        artifact,
      ),
    ).toThrow('AUTH_CLOUD_STAGING_RUNTIME_FINGERPRINT_MISMATCH')

    const claimed = parseCloudStagingEnvironment(
      stagingEnvironment({
        BCN_RELEASE_ARTIFACT_SHA256: 'b'.repeat(64),
        BCN_RELEASE_PACKAGE_VERSION: '1.2.3',
        BCN_RELEASE_RUNTIME_FINGERPRINT: runtimeFingerprint,
        BCN_RELEASE_SOURCE_COMMIT: 'a'.repeat(40),
      }),
    ) as Record<string, unknown>
    expect(claimed).not.toHaveProperty('BCN_RELEASE_RUNTIME_FINGERPRINT')

    const response = new Response('{}', {
      headers: { 'x-bcn-runtime-fingerprint': runtimeFingerprint },
    })
    expect(assertCloudRouteFingerprint(response, artifact, 'ROUTE_MISMATCH')).toBe(true)
    expect(() =>
      assertCloudRouteFingerprint(new Response('{}'), artifact, 'ROUTE_MISMATCH'),
    ).toThrow('ROUTE_MISMATCH')
  })

  it('cryptographically verifies the exact Convex session-token contract', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const kid = 'cloud-session-key'
    const header = { alg: 'RS256', kid }
    const now = Math.floor(Date.now() / 1_000)
    const claims = {
      aud: 'convex',
      exp: now + 900,
      iat: now,
      iss: `https://${deploymentName}.convex.site`,
      sid: 'persisted-session-id',
      sub: 'persisted-user-id',
      token_use: 'convex-session',
    }
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const signingInput = `${encodedHeader}.${encodedClaims}`
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString(
      'base64url',
    )
    const token = `${signingInput}.${signature}`
    const jwk = publicKey.export({ format: 'jwk' })
    const verified = verifyCloudSessionToken(
      token,
      { keys: [{ ...jwk, alg: 'RS256', kid }] },
      { convexSiteUrl: `https://${deploymentName}.convex.site` },
    )
    expect(verified.claims).toEqual(claims)
    expect(verified.evidence).toMatchObject({
      algorithm: 'RS256',
      signatureVerified: true,
      tokenUse: 'convex-session',
    })
    expect(() =>
      verifyCloudSessionToken(
        `${signingInput}.${`${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`}`,
        { keys: [{ ...jwk, alg: 'RS256', kid }] },
        { convexSiteUrl: `https://${deploymentName}.convex.site` },
      ),
    ).toThrow('AUTH_CLOUD_STAGING_SESSION_JWT_INVALID')
  })

  it('proves the clean fixture has one component mount and the installed artifact bytes', () => {
    const mount = readFileSync(
      resolve(root, 'starters/mcp-oauth-agent/convex/convex.config.ts'),
      'utf8',
    )
    expect(assertSingleBetterAuthMount(mount)).toBe(true)
    expect(() => assertSingleBetterAuthMount(`${mount}\napp.use(other)\n`)).toThrow(
      'AUTH_CLOUD_STAGING_COMPONENT_MOUNT_INVALID',
    )

    const moduleSource =
      "import { getPackedRuntimeFingerprint } from '../dist/runtime/shared/release-fingerprint.js'"
    const helperSource = `const fingerprint = '${runtimeFingerprint}'`
    expect(
      assertInstalledArtifactFingerprint(moduleSource, helperSource, { runtimeFingerprint }),
    ).toBe(true)
    expect(() =>
      assertInstalledArtifactFingerprint(
        moduleSource,
        `const fingerprint = 'bcn-release-v1-${'b'.repeat(64)}'`,
        { runtimeFingerprint },
      ),
    ).toThrow('AUTH_CLOUD_STAGING_INSTALLED_ARTIFACT_MISMATCH')
  })

  it('binds the pre-publication fixture to one exact three-package artifact family', () => {
    const sourceCommit = 'b'.repeat(40)
    const artifacts = {
      mcp: {
        identity: {
          package: 'better-convex-mcp',
          runtimeFingerprint: null,
          sourceCommit,
          version: '0.1.0-beta.25',
        },
        tarballPath: '/artifacts/better-convex-mcp.tgz',
      },
      nuxt: {
        identity: {
          package: 'better-convex-nuxt',
          runtimeFingerprint,
          sourceCommit,
          version: '0.8.0-beta.37',
        },
        tarballPath: '/artifacts/better-convex-nuxt.tgz',
      },
      vue: {
        identity: {
          package: 'better-convex-vue',
          runtimeFingerprint: null,
          sourceCommit,
          version: '0.8.0-beta.37',
        },
        tarballPath: '/artifacts/better-convex-vue.tgz',
      },
    }
    expect(assertCloudArtifactFamily(artifacts)).toBe(artifacts)
    const bound = bindCloudFixtureArtifacts(
      {
        dependencies: {
          'better-convex-mcp': 'registry-value',
          'better-convex-nuxt': 'registry-value',
        },
      },
      artifacts,
    )
    expect(bound.package.dependencies).toMatchObject({
      'better-convex-mcp': 'file:/artifacts/better-convex-mcp.tgz',
      'better-convex-nuxt': 'file:/artifacts/better-convex-nuxt.tgz',
      'better-convex-vue': 'file:/artifacts/better-convex-vue.tgz',
    })
    expect(bound.workspace).toContain(
      'better-convex-vue@0.8.0-beta.37: file:/artifacts/better-convex-vue.tgz',
    )
    expect(() =>
      assertCloudArtifactFamily({
        ...artifacts,
        vue: {
          ...artifacts.vue,
          identity: { ...artifacts.vue.identity, sourceCommit: 'c'.repeat(40) },
        },
      }),
    ).toThrow('AUTH_CLOUD_STAGING_ARTIFACT_FAMILY_MISMATCH')
    expect(parseCloudArtifactArguments(invalidArtifactArguments)).toEqual({
      mcpArtifactManifest: 'does-not-exist.mcp.artifact.json',
      nuxtArtifactManifest: 'does-not-exist.nuxt.artifact.json',
      vueArtifactManifest: 'does-not-exist.vue.artifact.json',
    })
  })

  it('fails closed unless every app and component model is empty before writes', () => {
    const authModels = Object.keys(packagedSchemaMetadata.models)
    const appTables = [
      'users',
      'organizations',
      'memberships',
      'delegations',
      'projects',
      'approvals',
      'mcpRateLimits',
    ]
    const expected = { appTables, authModels, runtimeFingerprint }
    const proof = {
      appCounts: Object.fromEntries(appTables.map((table) => [table, 0])),
      authCounts: Object.fromEntries(authModels.map((model) => [model, 0])),
      componentMounts: ['betterAuth'],
      runtimeFingerprint,
      schemaVersion: 1,
    }
    expect(normalizeCloudPrewriteProof(proof, expected)).toBe(true)
    expect(() =>
      normalizeCloudPrewriteProof(
        { ...proof, authCounts: { ...proof.authCounts, oauthAccessToken: 1 } },
        expected,
      ),
    ).toThrow('AUTH_CLOUD_STAGING_PREWRITE_STATE_NOT_EMPTY')
    expect(() =>
      normalizeCloudPrewriteProof(
        { ...proof, appCounts: { ...proof.appCounts, users: 1 } },
        expected,
      ),
    ).toThrow('AUTH_CLOUD_STAGING_PREWRITE_STATE_NOT_EMPTY')
    expect(() =>
      normalizeCloudPrewriteProof(
        { ...proof, componentMounts: ['betterAuth', 'legacy'] },
        expected,
      ),
    ).toThrow('AUTH_CLOUD_STAGING_PREWRITE_STATE_NOT_EMPTY')
  })

  it('accepts only the exact count-only authorization-code race evidence', () => {
    const evidence = { attempts: 2, rejected: 1, replayRejected: true, winners: 1 }
    expect(normalizeAuthorizationCodeEvidence(evidence)).toEqual(evidence)
    expect(() =>
      normalizeAuthorizationCodeEvidence({ ...evidence, accessToken: 'must-not-enter-report' }),
    ).toThrow('AUTH_CLOUD_STAGING_AUTHORIZATION_CODE_EVIDENCE_INVALID')
    expect(() => normalizeAuthorizationCodeEvidence({ ...evidence, winners: 2 })).toThrow(
      'AUTH_CLOUD_STAGING_AUTHORIZATION_CODE_EVIDENCE_INVALID',
    )
  })

  it('reverifies the artifact before making a cloud request', () => {
    const environment = stagingEnvironment()
    const result = spawnSync(
      process.execPath,
      ['scripts/run-auth-cloud-staging.mjs', ...invalidArtifactArguments],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...environment, PATH: process.env.PATH },
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('AUTH_CLOUD_STAGING_ARTIFACT_VERIFY_FAILED')
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(environment.CONVEX_DEPLOY_KEY)
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(
      environment.BCN_AUTH_STAGING_PASSWORD,
    )
  })

  it('fails before artifact or network work when protected topology is incomplete', () => {
    const deployKey = `prod:${deploymentName}|${'do-not-print-this-secret'.repeat(3)}`
    mkdirSync(resolve(root, '.release-artifacts'), { recursive: true })
    writeFileSync(reportPath, '{"result":"stale-pass"}\n')
    try {
      const result = spawnSync(
        process.execPath,
        ['scripts/run-auth-cloud-staging.mjs', ...invalidArtifactArguments],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            BCN_AUTH_STAGING_TEAM: 'better-convex',
            CONVEX_DEPLOY_KEY: deployKey,
            PATH: process.env.PATH,
          },
        },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('AUTH_CLOUD_STAGING_BCN_AUTH_STAGING_CONVEX_URL_MISSING')
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(deployKey)
      expect(`${result.stdout}\n${result.stderr}`).not.toContain('do-not-print-this-secret')
      expect(existsSync(reportPath)).toBe(false)
    } finally {
      rmSync(reportPath, { force: true })
    }
  })
})
