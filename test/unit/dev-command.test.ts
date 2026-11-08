import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runDevCommand } from '../../src/runtime/cli/dev'

// Stand-ins for the project's Convex and Nuxt CLIs. Convex writes the deployment URL the way
// `convex dev` does on a first run, with the VITE_ prefix when `vite` is a dependency, and keeps
// running. Like `convex dev`, it stops its local backend only on SIGINT; SIGTERM ends it without
// that cleanup. Nuxt records what it was started with and exits once Convex runs.
const FAKE_CONVEX = `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
process.on('SIGINT', () => { writeFileSync('convex-backend-stopped', ''); process.exit(130) })
writeFileSync('convex-start.json', JSON.stringify({ args: process.argv.slice(2), agentMode: process.env.CONVEX_AGENT_MODE ?? '' }))
let local = ''
try { local = readFileSync('.env.local', 'utf8') } catch {}
const prefix = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies?.vite ? 'VITE_' : ''
if (!local.includes('CONVEX_URL=')) {
  setTimeout(() => appendFileSync('.env.local', \`CONVEX_DEPLOYMENT=anonymous:anonymous-app\\n\${prefix}CONVEX_URL=http://127.0.0.1:3210\\n\`), 300)
}
setInterval(() => {}, 1000)
`
const FAKE_NUXT = `import { existsSync, writeFileSync } from 'node:fs'
writeFileSync('nuxt-start.json', JSON.stringify({ args: process.argv.slice(2), url: process.env.CONVEX_URL ?? '', site: process.env.SITE_URL ?? '', deployment: process.env.CONVEX_DEPLOYMENT ?? '' }))
process.exitCode = Number(process.env.FAKE_NUXT_STATUS ?? 0)
const exitOnceConvexRuns = () => existsSync('convex-start.json') || setTimeout(exitOnceConvexRuns, 10)
exitOnceConvexRuns()
`

describe('better-convex-nuxt dev', () => {
  it.each([
    {
      name: 'starts a local anonymous backend without .env.local',
      envLocal: undefined,
      convex: { args: ['dev'], agentMode: 'anonymous' },
      site: '',
    },
    {
      name: 'passes the URL that Convex names VITE_CONVEX_URL in a Vite project',
      envLocal: undefined,
      devDependencies: { vite: '8.3.5' },
      convex: { args: ['dev'], agentMode: 'anonymous' },
      site: '',
    },
    {
      name: 'uses the deployment that .env.local selects',
      envLocal:
        'CONVEX_DEPLOYMENT=local:local-team-app\nCONVEX_URL=http://127.0.0.1:3210\nSITE_URL=http://localhost:3000\n',
      convex: { args: ['dev'], agentMode: '' },
      site: 'http://localhost:3000',
    },
    {
      name: 'returns the status of a Nuxt that fails',
      envLocal:
        'CONVEX_DEPLOYMENT=local:local-team-app\nCONVEX_URL=http://127.0.0.1:3210\nFAKE_NUXT_STATUS=1\n',
      convex: { args: ['dev'], agentMode: '' },
      site: '',
      status: 1,
    },
  ])(
    '$name, then starts Nuxt with the URL',
    async ({ envLocal, devDependencies, convex, site, status = 0 }) => {
      const cwd = mkdtempSync(join(tmpdir(), 'bcn-dev-command-'))
      try {
        mkdirSync(join(cwd, 'node_modules/convex/bin'), { recursive: true })
        mkdirSync(join(cwd, 'node_modules/nuxt/bin'), { recursive: true })
        writeFileSync(join(cwd, 'node_modules/convex/bin/main.js'), FAKE_CONVEX)
        writeFileSync(join(cwd, 'node_modules/nuxt/bin/nuxt.mjs'), FAKE_NUXT)
        writeFileSync(
          join(cwd, 'package.json'),
          JSON.stringify({ type: 'module', devDependencies }),
        )
        if (envLocal) writeFileSync(join(cwd, '.env.local'), envLocal, { mode: 0o600 })

        // Nuxt exits on its own here, so dev stops Convex and returns Nuxt's status, not the
        // signal that ended Convex.
        await expect(runDevCommand(['--port', '3001'], { cwd })).resolves.toBe(status)

        const convexStart = JSON.parse(readFileSync(join(cwd, 'convex-start.json'), 'utf8'))
        expect(convexStart).toEqual(convex)
        // A local backend left running blocks its port for the next `dev`.
        expect(existsSync(join(cwd, 'convex-backend-stopped'))).toBe(true)
        const nuxtStart = JSON.parse(readFileSync(join(cwd, 'nuxt-start.json'), 'utf8'))
        // Nuxt gets the URL and the app's own values, never the deployment selector.
        expect(nuxtStart).toEqual({
          args: ['dev', '--port', '3001'],
          url: 'http://127.0.0.1:3210',
          site,
          deployment: '',
        })
      } finally {
        rmSync(cwd, { force: true, recursive: true })
      }
    },
  )

  it('refuses a deployment that is not for development', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bcn-dev-command-'))
    try {
      writeFileSync(join(cwd, '.env.local'), 'CONVEX_DEPLOYMENT=prod:fixture-app\n', {
        mode: 0o600,
      })
      await expect(runDevCommand([], { cwd })).rejects.toThrow(
        'This command requires development, local, or anonymous authority.',
      )
    } finally {
      rmSync(cwd, { force: true, recursive: true })
    }
  })
})
