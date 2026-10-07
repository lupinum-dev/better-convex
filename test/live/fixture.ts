// The starter for `pnpm test:live`: on a fresh Convex preview deployment, or with BCN_LIVE_LOCAL=1
// on the local backend that `pnpm test:integration` uses (a dry run of the journey, no cloud).
//
// The cloud path: copy the starter with the built packages and the operator-only test functions,
// `convex deploy --preview-create`, set the auth secrets, then run the starter's Nuxt server on
// this machine against the deployment. Convex deletes old preview deployments on its own.
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  availablePort,
  cleanEnvironment,
  convexCli,
  prepareStarterCopy,
  runCommand,
  signUpFixtureUser,
  startMcpFixture,
  startNuxtServer,
  type JsonRecord,
  type McpFixture,
} from '../integration/harness'
import { liveTarget } from './target'

export type LiveFixture = Pick<
  McpFixture,
  'convexSiteUrl' | 'convexUrl' | 'email' | 'origin' | 'password' | 'runConvex' | 'release'
>

export async function startLiveFixture(): Promise<LiveFixture> {
  const target = liveTarget(process.env)
  if (target.kind === 'local') return await startMcpFixture()

  const tempRoot = await mkdtemp(join(tmpdir(), 'bcn-live-'))
  const cwd = join(tempRoot, 'app')
  const email = `live-${randomBytes(8).toString('hex')}@example.test`
  const password = `${randomBytes(24).toString('base64url')}!aA1`
  const betterAuthSecrets = `1:${randomBytes(32).toString('base64url')}`
  const proxyIpSecret = randomBytes(32).toString('base64url')
  const secrets = [target.deployKey, password, betterAuthSecrets, proxyIpSecret]
  let nuxt: Awaited<ReturnType<typeof startNuxtServer>> | undefined
  const release = async () => {
    await nuxt?.release()
    await rm(tempRoot, { force: true, recursive: true })
  }

  try {
    await prepareStarterCopy(cwd)
    // Only the deploy key selects the deployment: no CONVEX_* value of this shell reaches the CLI.
    const env = { ...cleanEnvironment(), CONVEX_DEPLOY_KEY: target.deployKey }
    const convex = (args: string[]) =>
      runCommand(process.execPath, [convexCli, ...args], { cwd, env, secrets })
    const preview = ['--preview-name', target.previewName]

    // `--cmd` runs with the deployment URL in its environment; it writes the URL to a file.
    await convex([
      'deploy',
      '--preview-create',
      target.previewName,
      '--typecheck',
      'disable',
      '--cmd-url-env-var-name',
      'BCN_LIVE_CONVEX_URL',
      '--cmd',
      `node -e "require('node:fs').writeFileSync('deployment-url', process.env.BCN_LIVE_CONVEX_URL)"`,
    ])
    const convexUrl = (await readFile(join(cwd, 'deployment-url'), 'utf8')).trim()
    if (!/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.convex\.cloud$/u.test(convexUrl)) {
      throw new Error(`The deploy reported an unexpected deployment URL: ${convexUrl}`)
    }
    const convexSiteUrl = convexUrl.replace(/\.convex\.cloud$/u, '.convex.site')
    const origin = `http://127.0.0.1:${await availablePort()}`

    // From a file with owner-only access, so no secret is on a command line.
    const envFile = join(tempRoot, 'deployment.env')
    await writeFile(
      envFile,
      [
        `SITE_URL=${origin}`,
        `BETTER_AUTH_SECRETS=${betterAuthSecrets}`,
        `BCN_AUTH_PROXY_IP_SECRET=${proxyIpSecret}`,
      ].join('\n'),
      { mode: 0o600 },
    )
    await convex(['env', ...preview, 'set', '--from-file', envFile, '--force'])
    await convex(['run', ...preview, 'auth:rotateSigningKey', '{}'])

    nuxt = await startNuxtServer(
      cwd,
      origin,
      {
        ...cleanEnvironment(),
        BCN_AUTH_PROXY_IP_SECRET: proxyIpSecret,
        CONVEX_SITE_URL: convexSiteUrl,
        CONVEX_URL: convexUrl,
        NUXT_PUBLIC_CONVEX_SITE_URL: convexSiteUrl,
        NUXT_PUBLIC_CONVEX_URL: convexUrl,
      },
      secrets,
    )
    await signUpFixtureUser(origin, email, password)

    return Object.freeze({
      convexSiteUrl,
      convexUrl,
      email,
      origin,
      password,
      runConvex: async (functionName: string, args: JsonRecord = {}) => {
        const output = await convex(['run', ...preview, functionName, JSON.stringify(args)])
        try {
          return JSON.parse(output) as unknown
        } catch {
          return output
        }
      },
      release,
    })
  } catch (error) {
    await release()
    throw error
  }
}
