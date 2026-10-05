import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  assertConvexAuthoritySelection,
  buildConvexCommandEnvironment,
  inspectConvexAuthority,
  runConvexCommand,
} from '../../src/runtime/cli/convex'

/** Runs `check` in a temporary project with the given files, then removes it. */
async function withProject(files: Record<string, string>, check: (cwd: string) => Promise<void>) {
  const cwd = mkdtempSync(join(tmpdir(), 'bcn-convex-authority-'))
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, name)), { recursive: true })
    writeFileSync(join(cwd, name), contents, { mode: 0o600 })
  }
  try {
    await check(cwd)
  } finally {
    rmSync(cwd, { force: true, recursive: true })
  }
}

const CLI = 'node_modules/convex/bin/main.js'

describe('checked Convex CLI deployment authority', () => {
  it.each(['--help', '-h'])('prints help through the consolidated CLI: %s', async (flag) => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(runConvexCommand([flag])).resolves.toBe(0)
    expect(output).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
    output.mockRestore()
  })

  it.each([
    { CONVEX_DEPLOYMENT: 'local:fixture' },
    { CONVEX_DEPLOYMENT: 'local:local-team_project-fixture' },
    { CONVEX_DEPLOYMENT: 'anonymous:anonymous-fixture workspace' },
    { CONVEX_DEPLOY_KEY: 'dev:fixture-deployment|fixture-key' },
    { CONVEX_DEPLOYMENT_TOKEN: 'prod:fixture-deployment|fixture-token' },
    {
      CONVEX_SELF_HOSTED_ADMIN_KEY: 'fixture-admin',
      CONVEX_SELF_HOSTED_URL: 'http://127.0.0.1:3210',
    },
  ] as ReadonlyArray<Readonly<Record<string, string>>>)(
    'accepts one explicit selector class: %#',
    (environment) => {
      expect(() => assertConvexAuthoritySelection(environment)).not.toThrow()
    },
  )

  it.each([
    {},
    { CONVEX_DEPLOY_KEY: 'one', CONVEX_DEPLOYMENT_TOKEN: 'two' },
    { CONVEX_DEPLOY_KEY: 'fixture-key' },
    { CONVEX_DEPLOY_KEY: 'project:fixture|fixture-key' },
    { CONVEX_DEPLOY_KEY: 'preview:team:project|fixture-key' },
    { CONVEX_DEPLOYMENT: 'local:one', CONVEX_DEPLOY_KEY: 'two' },
    { CONVEX_SELF_HOSTED_URL: 'http://127.0.0.1:3210' },
    { CONVEX_SELF_HOSTED_ADMIN_KEY: 'fixture-admin' },
    { CONVEX_DEPLOYMENT: 'local:one', CONVEX_OVERRIDE_ACCESS_TOKEN: 'hidden' },
    { CONVEX_DEPLOYMENT: 'local:one', CONVEX_PROVISION_HOST: 'https://wrong.invalid' },
    {
      CONVEX_DEPLOYMENT: 'local:one',
      CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: '120',
    },
    {
      CONVEX_DEPLOYMENT: 'dev:safe-deployment',
      convex_deploy_key: 'prod:wrong-deployment|hidden',
    },
    { CONVEX_DEPLOYMENT: 'anonymous:fixture' },
    { CONVEX_DEPLOYMENT: 'anonymous:anonymous-fixture/../../outside' },
    { CONVEX_DEPLOYMENT: 'anonymous:anonymous-fixture\\..\\outside' },
    {
      CONVEX_DEPLOYMENT: 'local:one',
      CONVEX_SELF_HOSTED_ADMIN_KEY: 'fixture-admin',
      CONVEX_SELF_HOSTED_URL: 'http://127.0.0.1:3210',
    },
  ] as ReadonlyArray<Readonly<Record<string, string>>>)(
    'rejects missing, incomplete, conflicting, or hidden selectors: %#',
    (environment) => {
      expect(() => assertConvexAuthoritySelection(environment)).toThrow(/Convex authority file/u)
    },
  )

  it('removes every ambient Convex authority and installs only file-owned selection', () => {
    const result = buildConvexCommandEnvironment(
      {
        PATH: '/safe/bin',
        CONVEX_DEPLOY_KEY: 'ambient-key',
        convex_override_access_token: 'ambient-override',
        CONVEX_PROVISION_HOST: 'https://ambient.invalid',
      },
      {
        CONVEX_DEPLOYMENT: 'local:file-owned',
        CONVEX_SITE_URL: 'http://127.0.0.1:3211',
        CONVEX_URL: 'http://127.0.0.1:3210',
      },
    )

    expect(result.PATH).toBe('/safe/bin')
    expect(result.CONVEX_DEPLOYMENT).toBe('local:file-owned')
    for (const name of [
      'CONVEX_DEPLOY_KEY',
      'CONVEX_DEPLOYMENT_TOKEN',
      'CONVEX_OVERRIDE_ACCESS_TOKEN',
      'CONVEX_PROVISION_HOST',
      'CONVEX_SELF_HOSTED_ADMIN_KEY',
      'CONVEX_SELF_HOSTED_URL',
    ]) {
      expect(result[name], name).toBe('')
    }
    expect(result.CONVEX_AGENT_MODE).toBe('')
    expect(result.CONVEX_ALLOW_ANONYMOUS).toBe('')
  })

  it.each([
    { label: 'absent', inherited: {}, expected: undefined },
    {
      label: 'empty',
      inherited: { CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: '' },
      expected: undefined,
    },
    {
      label: 'positive',
      inherited: { CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: '120' },
      expected: '120',
    },
    {
      label: 'fractional positive',
      inherited: { CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: '0.5' },
      expected: '0.5',
    },
  ])('treats the local-backend timeout as optional non-authority tuning: $label', (input) => {
    const result = buildConvexCommandEnvironment(input.inherited, {
      CONVEX_DEPLOYMENT: 'local:file-owned',
    })

    expect(result.CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS).toBe(input.expected)
  })

  it.each(['not-a-number', '0', '-1', 'Infinity'])(
    'rejects an invalid local-backend timeout before spawning Convex: %s',
    (value) => {
      expect(() =>
        buildConvexCommandEnvironment(
          { CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: value },
          { CONVEX_DEPLOYMENT: 'local:file-owned' },
        ),
      ).toThrow('local Convex backend startup timeout must be a positive number')
    },
  )

  it('preserves non-authority timeout tuning with deployment-key authority', () => {
    const result = buildConvexCommandEnvironment(
      { CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: '90' },
      { CONVEX_DEPLOY_KEY: 'dev:fixture-deployment|fixture-key' },
    )

    expect(result.CONVEX_DEPLOY_KEY).toBe('dev:fixture-deployment|fixture-key')
    expect(result.CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS).toBe('90')
  })

  it('derives anonymous mode only from an accepted anonymous deployment selector', () => {
    const result = buildConvexCommandEnvironment(
      { CONVEX_AGENT_MODE: 'wrong', CONVEX_ALLOW_ANONYMOUS: 'false' },
      { CONVEX_DEPLOYMENT: 'anonymous:anonymous-safe fixture' },
    )

    expect(result.CONVEX_DEPLOYMENT).toBe('anonymous:anonymous-safe fixture')
    expect(result.CONVEX_AGENT_MODE).toBe('anonymous')
    expect(result.CONVEX_ALLOW_ANONYMOUS).toBe('true')
  })

  it.each([
    ['--deployment', 'prod'],
    '--admin-key=secret',
    '--anonymous',
    '--cloud',
    '--configure=existing',
    '--deployment=prod',
    '--deployment-name=wrong-deployment',
    '--dev-deployment=cloud',
    '--env-file=wrong.env',
    '--local',
    '--local-backend-version=attacker-version',
    '--override-auth-url=https://wrong.invalid',
    '--preview-create=wrong-preview',
    '--preview-name=wrong-preview',
    '--prod',
    '--project=wrong-project',
    '--team=wrong-team',
    '--type=prod',
    '--url=https://wrong.invalid',
  ])('rejects a target or hidden authority override before starting the CLI: %s', async (flag) => {
    await expect(
      runConvexCommand(['run', 'fixture:read', '{}', ...[flag].flat()], {
        cwd: process.cwd(),
      }),
    ).rejects.toThrow('Deployment overrides are not supported')
  })

  it.each([
    'CONVEX_DEPLOYMENT=dev:safe\nCONVEX_DEPLOY_KEY: prod:wrong|secret\n',
    'CONVEX_DEPLOYMENT=dev:safe\nIGNORED=x\rCONVEX_DEPLOY_KEY=prod:wrong|secret\n',
    'CONVEX_DEPLOYMENT=dev:expected\nCONVEX_DEPLOYMENT=prod:other\n',
  ])('rejects authority bytes with a parser differential before spawn', async (source) => {
    await withProject({ '.env.local': source }, async (cwd) => {
      await expect(runConvexCommand(['run', 'fixture:read', '{}'], { cwd })).rejects.toThrow(
        'Convex authority file is missing, invalid, or too large',
      )
    })
  })

  it.each([
    [
      'CONVEX_DEPLOYMENT=prod:fixture\n',
      ['dev', '--once'],
      'Dev requires a dev, local, anonymous, or development-key authority',
    ],
    [
      'CONVEX_DEPLOYMENT=prod:fixture\n',
      ['deploy'],
      'Deploy requires a deployment-scoped key or self-hosted authority',
    ],
    [
      'CONVEX_DEPLOY_KEY=dev:fixture-deployment|fixture-key\n',
      ['deploy'],
      'Deploy requires a production deployment key or self-hosted authority',
    ],
    [
      'CONVEX_DEPLOY_KEY=prod:fixture-deployment|fixture-key\n',
      ['dev', '--once'],
      'Dev requires a development deployment key or local authority',
    ],
  ])(
    'enforces command-specific authority classes before spawning Convex: %s %j',
    async (env, args, message) => {
      await withProject({ '.env.local': env }, async (cwd) => {
        await expect(runConvexCommand(args, { cwd })).rejects.toThrow(message)
      })
    },
  )

  it('pins development-only commands to one confirmed authority snapshot', async () => {
    const files = {
      '.env.local': 'CONVEX_DEPLOYMENT=dev:confirmed\n',
      [CLI]: 'process.exitCode = 0\n',
    }
    await withProject(files, async (cwd) => {
      const authority = await inspectConvexAuthority(cwd)
      expect(authority).toMatchObject({ development: true, label: 'dev:confirmed' })
      await expect(
        runConvexCommand(['env', 'list', '--names-only'], {
          cwd,
          developmentOnly: true,
          expectedAuthorityDigest: authority.digest,
          quiet: true,
        }),
      ).resolves.toBe(0)

      writeFileSync(join(cwd, '.env.local'), 'CONVEX_DEPLOYMENT=dev:changed\n', { mode: 0o600 })
      await expect(
        runConvexCommand(['env', 'list', '--names-only'], {
          cwd,
          developmentOnly: true,
          expectedAuthorityDigest: authority.digest,
          quiet: true,
        }),
      ).rejects.toThrow('authority file changed')

      writeFileSync(join(cwd, '.env.local'), 'CONVEX_DEPLOY_KEY=prod:production|secret\n', {
        mode: 0o600,
      })
      await expect(
        runConvexCommand(['run', 'auth:ensureSigningKey', '{}'], {
          cwd,
          developmentOnly: true,
          quiet: true,
        }),
      ).rejects.toThrow('requires development, local, or anonymous authority')
    })
  })

  it('executes the pinned CLI with the fixed file authority and no ambient Convex values', async () => {
    const files = {
      '.env.local': 'CONVEX_DEPLOYMENT=local:file-owned\n',
      '.env':
        'CONVEX_DEPLOY_KEY=sibling-key\nCONVEX_OVERRIDE_ACCESS_TOKEN=sibling-override\nCONVEX_PROVISION_HOST=https://sibling.invalid\n',
      [CLI]: [
        "process.loadEnvFile('.env')",
        "const valid = process.argv.slice(2).join(' ') === 'codegen --dry-run'",
        "  && process.env.CONVEX_DEPLOYMENT === 'local:file-owned'",
        "  && process.env.CONVEX_DEPLOY_KEY === ''",
        "  && process.env.CONVEX_OVERRIDE_ACCESS_TOKEN === ''",
        "  && process.env.CONVEX_PROVISION_HOST === ''",
        'process.exitCode = valid ? 0 : 41',
      ].join('\n'),
    }

    await withProject(files, async (cwd) => {
      await expect(
        runConvexCommand(['codegen', '--dry-run'], {
          cwd,
          inheritedEnvironment: {
            CONVEX_DEPLOY_KEY: 'ambient-key',
            CONVEX_OVERRIDE_ACCESS_TOKEN: 'ambient-override',
            CONVEX_PROVISION_HOST: 'https://ambient.invalid',
          },
        }),
      ).resolves.toBe(0)
    })
  })

  it('clears dotenv and ambient authority for configuration and anonymous development', async () => {
    const files = {
      '.env.local':
        'CONVEX_DEPLOYMENT=prod:stale\nCONVEX_AGENT_MODE=anonymous\nCONVEX_ALLOW_ANONYMOUS=true\n',
      '.env':
        'CONVEX_OVERRIDE_ACCESS_TOKEN=sibling-override\nCONVEX_PROVISION_HOST=https://sibling.invalid\n',
      [CLI]: [
        "process.loadEnvFile('.env.local')",
        "process.loadEnvFile('.env')",
        "const args = process.argv.slice(2).join(' ')",
        "const mode = args === 'dev --configure'",
        "  ? process.env.CONVEX_AGENT_MODE === '' && process.env.CONVEX_ALLOW_ANONYMOUS === ''",
        "  : args === 'dev --local-cloud-port 43210 --local-site-port 43211 --once'",
        "    && process.env.CONVEX_AGENT_MODE === 'anonymous'",
        "    && process.env.CONVEX_ALLOW_ANONYMOUS === 'true'",
        "const valid = mode && process.env.CONVEX_DEPLOYMENT === ''",
        "  && process.env.CONVEX_OVERRIDE_ACCESS_TOKEN === ''",
        "  && process.env.CONVEX_PROVISION_HOST === ''",
        "  && (args === 'dev --configure'",
        '    ? process.env.CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS === undefined',
        "    : process.env.CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS === '45')",
        'process.exitCode = valid ? 0 : 42',
      ].join('\n'),
    }

    await withProject(files, async (cwd) => {
      await expect(
        runConvexCommand(['configure'], {
          cwd,
          inheritedEnvironment: {
            CONVEX_AGENT_MODE: 'anonymous',
            CONVEX_ALLOW_ANONYMOUS: 'true',
            CONVEX_OVERRIDE_ACCESS_TOKEN: 'ambient-override',
          },
        }),
      ).resolves.toBe(0)
      await expect(
        runConvexCommand(
          [
            'dev',
            '--anonymous',
            '--local-cloud-port',
            '43210',
            '--local-site-port',
            '43211',
            '--once',
          ],
          {
            cwd,
            inheritedEnvironment: {
              CONVEX_DEPLOY_KEY: 'ambient-key',
              CONVEX_DEPLOYMENT: 'prod:ambient',
              CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: '45',
            },
          },
        ),
      ).resolves.toBe(0)
    })
  })
})
