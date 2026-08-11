import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  parseMcpEvidenceFixtureConfiguration,
  safeMcpFixtureChildEnvironment,
  startMcpEvidenceFixture,
} from '../../scripts/mcp-evidence-fixture.mjs'

const validExternalEnvironment = (appDir = '/tmp/bcn-external-mcp-fixture') => ({
  BCN_MCP_TEST_APP_DIR: appDir,
  BCN_MCP_TEST_CONVEX_SITE_URL: 'https://gentle-otter-123.convex.site',
  BCN_MCP_TEST_CONVEX_URL: 'https://gentle-otter-123.convex.cloud',
  BCN_MCP_TEST_EMAIL: 'mcp-evidence@example.test',
  BCN_MCP_TEST_MODE: 'external-disposable',
  BCN_MCP_TEST_ORIGIN: 'https://mcp-disposable.example.test',
  BCN_MCP_TEST_PASSWORD: 'one-time-password',
})

describe('MCP evidence fixture selection', () => {
  it('keeps the self-contained local fixture as the only default', () => {
    expect(parseMcpEvidenceFixtureConfiguration({})).toEqual({ mode: 'local' })
    expect(parseMcpEvidenceFixtureConfiguration({ BCN_MCP_TEST_MODE: 'local' })).toEqual({
      mode: 'local',
    })
    expect(() =>
      parseMcpEvidenceFixtureConfiguration({
        BCN_MCP_TEST_EMAIL: 'unexpected@example.test',
      }),
    ).toThrow(/external-disposable/)
  })

  it('fails unknown modes and every incomplete external-disposable configuration', () => {
    expect(() => parseMcpEvidenceFixtureConfiguration({ BCN_MCP_TEST_MODE: 'cloud' })).toThrow(
      /Unknown BCN_MCP_TEST_MODE/,
    )

    const complete = validExternalEnvironment()
    for (const name of Object.keys(complete).filter((name) => name !== 'BCN_MCP_TEST_MODE')) {
      const incomplete = Object.fromEntries(
        Object.entries(complete).filter(([candidate]) => candidate !== name),
      )
      expect(() => parseMcpEvidenceFixtureConfiguration(incomplete)).toThrow(name)
    }
  })

  it('accepts only an absolute app path and exact secure or loopback origins', () => {
    expect(parseMcpEvidenceFixtureConfiguration(validExternalEnvironment())).toMatchObject({
      appDir: '/tmp/bcn-external-mcp-fixture',
      mode: 'external-disposable',
      origin: 'https://mcp-disposable.example.test',
    })
    expect(() =>
      parseMcpEvidenceFixtureConfiguration(validExternalEnvironment('relative/app')),
    ).toThrow(/absolute path/)
    expect(() =>
      parseMcpEvidenceFixtureConfiguration({
        ...validExternalEnvironment(),
        BCN_MCP_TEST_ORIGIN: 'https://mcp-disposable.example.test/',
      }),
    ).toThrow(/exact canonical origin/)
    expect(() =>
      parseMcpEvidenceFixtureConfiguration({
        ...validExternalEnvironment(),
        BCN_MCP_TEST_CONVEX_URL: 'http://disposable.example.convex.cloud',
      }),
    ).toThrow(/HTTPS/)
    expect(() =>
      parseMcpEvidenceFixtureConfiguration({
        ...validExternalEnvironment(),
        BCN_MCP_TEST_CONVEX_URL: 'https://mcp-api.example.test',
      }),
    ).toThrow(/canonical managed Convex/)
    expect(() =>
      parseMcpEvidenceFixtureConfiguration({
        ...validExternalEnvironment(),
        BCN_MCP_TEST_CONVEX_SITE_URL: 'https://gentle-fox-456.convex.site',
      }),
    ).toThrow(/must name the same deployment/)
    expect(
      parseMcpEvidenceFixtureConfiguration({
        ...validExternalEnvironment(),
        BCN_MCP_TEST_CONVEX_SITE_URL: 'https://gentle-otter-123.eu-west-1.convex.site',
        BCN_MCP_TEST_CONVEX_URL: 'https://gentle-otter-123.eu-west-1.convex.cloud',
      }),
    ).toMatchObject({
      deploymentName: 'gentle-otter-123',
      deploymentRegion: 'eu-west-1',
    })
    expect(() =>
      parseMcpEvidenceFixtureConfiguration({
        ...validExternalEnvironment(),
        BCN_MCP_TEST_CONVEX_SITE_URL: 'https://gentle-otter-123.us-east-1.convex.site',
        BCN_MCP_TEST_CONVEX_URL: 'https://gentle-otter-123.eu-west-1.convex.cloud',
      }),
    ).toThrow(/same deployment and region/)
    expect(() =>
      parseMcpEvidenceFixtureConfiguration({
        ...validExternalEnvironment(),
        BCN_MCP_TEST_PASSWORD: 'short-password',
      }),
    ).toThrow(/between 15 and 1,024/)
  })

  it('strips fixture and deployment credentials from every child environment', () => {
    const child = safeMcpFixtureChildEnvironment({
      ...validExternalEnvironment(),
      BCN_AUTH_PROXY_IP_SECRET: 'proxy-secret',
      BCN_MCP_CONFORMANCE_BEARER: 'bearer-secret',
      BCN_MCP_RELEASE_TARBALL: '/tmp/mcp-candidate.tgz',
      BETTER_AUTH_SECRETS: '1:better-auth-secret',
      Better_Auth_Secret: 'windows-case-insensitive-better-auth-secret',
      Bcn_Mcp_Test_Password: 'windows-case-insensitive-fixture-secret',
      CONVEX_DEPLOY_KEY: 'deployment-secret',
      CONVEX_DEPLOYMENT: 'prod:wrong-deployment',
      CONVEX_DEPLOYMENT_TOKEN: 'deployment-token-secret',
      CONVEX_FUTURE_OVERRIDE: 'future-override',
      Convex_Mixed_Case_Override: 'windows-case-insensitive-secret',
      CONVEX_OVERRIDE_ACCESS_TOKEN: 'access-token-secret',
      CONVEX_PROVISION_HOST: 'http://127.0.0.1:6789',
      CONVEX_SELF_HOSTED_ADMIN_KEY: 'self-hosted-secret',
      MCP_SERVER_SECRET: 'private-mcp-secret',
      PATH: '/safe/bin',
    })
    expect(child).toEqual({ PATH: '/safe/bin' })
  })

  it('uses an existing exact-topology app and never cleans the external fixture', async () => {
    const appDir = await mkdtemp(join(tmpdir(), 'bcn-external-mcp-contract-'))
    const environment = validExternalEnvironment(appDir)
    await writeFile(
      join(appDir, '.env.local'),
      [
        'export CONVEX_DEPLOYMENT=dev:gentle-otter-123 # team: example, project: proof',
        `SITE_URL: ${environment.BCN_MCP_TEST_ORIGIN}`,
        `CONVEX_URL="${environment.BCN_MCP_TEST_CONVEX_URL}"`,
        `CONVEX_SITE_URL='${environment.BCN_MCP_TEST_CONVEX_SITE_URL}'`,
        `NUXT_PUBLIC_CONVEX_URL=\`${environment.BCN_MCP_TEST_CONVEX_URL}\``,
        `NUXT_PUBLIC_CONVEX_SITE_URL=${environment.BCN_MCP_TEST_CONVEX_SITE_URL}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    )
    try {
      const fixture = await startMcpEvidenceFixture(environment)
      expect(fixture).toMatchObject({
        cwd: appDir,
        email: environment.BCN_MCP_TEST_EMAIL,
        origin: environment.BCN_MCP_TEST_ORIGIN,
      })
      await fixture.release()
      await fixture.release()
      expect((await stat(appDir)).isDirectory()).toBe(true)
    } finally {
      await rm(appDir, { force: true, recursive: true })
    }
  })

  it('rejects an app directory whose .env.local selects a different topology', async () => {
    const appDir = await mkdtemp(join(tmpdir(), 'bcn-external-mcp-mismatch-'))
    const environment = validExternalEnvironment(appDir)
    await writeFile(
      join(appDir, '.env.local'),
      [
        'CONVEX_DEPLOYMENT=dev:gentle-otter-123',
        'SITE_URL=https://different.example.test',
        `CONVEX_URL=${environment.BCN_MCP_TEST_CONVEX_URL}`,
        `CONVEX_SITE_URL=${environment.BCN_MCP_TEST_CONVEX_SITE_URL}`,
        `NUXT_PUBLIC_CONVEX_URL=${environment.BCN_MCP_TEST_CONVEX_URL}`,
        `NUXT_PUBLIC_CONVEX_SITE_URL=${environment.BCN_MCP_TEST_CONVEX_SITE_URL}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    )
    try {
      await expect(startMcpEvidenceFixture(environment)).rejects.toThrow(/exactly match/)
    } finally {
      await rm(appDir, { force: true, recursive: true })
    }
  })

  it('rejects selector drift, production selectors, and hidden Convex CLI authority', async () => {
    const cases = [
      {
        extra: '',
        selector: 'dev:wrong-otter-456',
      },
      {
        extra: '',
        selector: 'prod:gentle-otter-123',
      },
      {
        extra: '',
        selector: 'gentle-otter-123',
      },
      {
        extra: '',
        selector: 'local:gentle-otter-123',
      },
      {
        extra: 'CONVEX_DEPLOY_KEY=must-not-override-selection',
        selector: 'dev:gentle-otter-123',
      },
      {
        extra: 'CONVEX_DEPLOYMENT_TOKEN=must-not-override-selection',
        selector: 'dev:gentle-otter-123',
      },
      {
        extra: 'CONVEX_OVERRIDE_ACCESS_TOKEN=must-not-override-selection',
        selector: 'dev:gentle-otter-123',
      },
      {
        extra: 'export CONVEX_DEPLOY_KEY=must-not-override-selection',
        selector: 'dev:gentle-otter-123',
      },
      {
        extra: 'CONVEX_DEPLOY_KEY: must-not-override-selection',
        selector: 'dev:gentle-otter-123',
      },
      {
        extra: 'convex_deploy_key=must-not-override-selection',
        selector: 'dev:gentle-otter-123',
      },
      {
        extra: 'CONVEX_DEPLOYMENT=dev:gentle-otter-123',
        selector: 'dev:gentle-otter-123',
      },
    ]

    for (const testCase of cases) {
      const appDir = await mkdtemp(join(tmpdir(), 'bcn-external-mcp-selector-'))
      const environment = validExternalEnvironment(appDir)
      await writeFile(
        join(appDir, '.env.local'),
        [
          `CONVEX_DEPLOYMENT=${testCase.selector}`,
          `SITE_URL=${environment.BCN_MCP_TEST_ORIGIN}`,
          `CONVEX_URL=${environment.BCN_MCP_TEST_CONVEX_URL}`,
          `CONVEX_SITE_URL=${environment.BCN_MCP_TEST_CONVEX_SITE_URL}`,
          `NUXT_PUBLIC_CONVEX_URL=${environment.BCN_MCP_TEST_CONVEX_URL}`,
          `NUXT_PUBLIC_CONVEX_SITE_URL=${environment.BCN_MCP_TEST_CONVEX_SITE_URL}`,
          testCase.extra,
          '',
        ].join('\n'),
        { mode: 0o600 },
      )
      try {
        await expect(startMcpEvidenceFixture(environment)).rejects.toThrow(
          /(?:deployment selector and origins|unsupported CONVEX_|duplicate CONVEX_DEPLOYMENT)/,
        )
      } finally {
        await rm(appDir, { force: true, recursive: true })
      }
    }
  })

  it.runIf(process.platform !== 'win32')(
    'rejects a publicly readable external env file',
    async () => {
      const appDir = await mkdtemp(join(tmpdir(), 'bcn-external-mcp-mode-'))
      const environment = validExternalEnvironment(appDir)
      await writeFile(
        join(appDir, '.env.local'),
        [
          'CONVEX_DEPLOYMENT=dev:gentle-otter-123',
          `SITE_URL=${environment.BCN_MCP_TEST_ORIGIN}`,
          `CONVEX_URL=${environment.BCN_MCP_TEST_CONVEX_URL}`,
          `CONVEX_SITE_URL=${environment.BCN_MCP_TEST_CONVEX_SITE_URL}`,
          `NUXT_PUBLIC_CONVEX_URL=${environment.BCN_MCP_TEST_CONVEX_URL}`,
          `NUXT_PUBLIC_CONVEX_SITE_URL=${environment.BCN_MCP_TEST_CONVEX_SITE_URL}`,
          '',
        ].join('\n'),
        { mode: 0o644 },
      )
      try {
        await expect(startMcpEvidenceFixture(environment)).rejects.toThrow(/mode 0600/)
      } finally {
        await rm(appDir, { force: true, recursive: true })
      }
    },
  )

  it('rejects a sibling .env before the CLI can load hidden authority', async () => {
    const appDir = await mkdtemp(join(tmpdir(), 'bcn-external-mcp-dotenv-'))
    const environment = validExternalEnvironment(appDir)
    await writeFile(
      join(appDir, '.env.local'),
      [
        'CONVEX_DEPLOYMENT=dev:gentle-otter-123',
        `SITE_URL=${environment.BCN_MCP_TEST_ORIGIN}`,
        `CONVEX_URL=${environment.BCN_MCP_TEST_CONVEX_URL}`,
        `CONVEX_SITE_URL=${environment.BCN_MCP_TEST_CONVEX_SITE_URL}`,
        `NUXT_PUBLIC_CONVEX_URL=${environment.BCN_MCP_TEST_CONVEX_URL}`,
        `NUXT_PUBLIC_CONVEX_SITE_URL=${environment.BCN_MCP_TEST_CONVEX_SITE_URL}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    )
    await writeFile(join(appDir, '.env'), 'CONVEX_DEPLOY_KEY=hidden-authority\n')
    try {
      await expect(startMcpEvidenceFixture(environment)).rejects.toThrow(/sibling \.env/)
    } finally {
      await rm(appDir, { force: true, recursive: true })
    }
  })

  it('pins the repository Convex CLI and .env.local without deployment lifecycle commands', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../scripts/mcp-evidence-fixture.mjs', import.meta.url)),
      'utf8',
    )
    expect(source).toContain(
      "fileURLToPath(new URL('../node_modules/convex/bin/main.js', import.meta.url))",
    )
    expect(source).toMatch(/'--',\s*convexCli,\s*'run',\s*functionName/u)
    expect(source).toMatch(/'--',\s*convexCli,\s*'deployment',\s*'select'/u)
    expect(source).toContain("'deployment', 'select', configuration.deploymentName")
    expect(source).toContain("'--deployment'")
    expect(source).toContain('configuration.deploymentName')
    expect(source).toContain("'--env-file'")
    expect(source).toContain('authority.envFile')
    expect(source).toContain('selected?.[1] !== configuration.deploymentName')
    expect(source).toContain('cwd: configuration.appDir')
    expect(source).not.toMatch(/\b(?:deploy|provision|sign-up)\b/u)
    expect(source).not.toContain("['env', 'set'")
    expect(source).not.toContain('rm(configuration.appDir')
  })

  it('keeps direct PKCE evidence independent of Inspector and credential logging', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../scripts/run-mcp-auth.mjs', import.meta.url)),
      'utf8',
    )
    expect(source).toContain('acquirePublicClientToken')
    expect(source).not.toContain('mcp-inspector')
    expect(source).not.toContain('inspectorToken')
    expect(source).not.toMatch(/console\.\w+\([^)]*fixture\.(?:email|password)/u)
  })
})
