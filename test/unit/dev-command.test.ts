import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runDevCommand } from '../../src/runtime/cli/dev'

// Stand-ins for the project's Convex and Nuxt CLIs. Convex writes the deployment URL the way
// `convex dev` does on a first run and keeps running; Nuxt records what it was started with.
const FAKE_CONVEX = `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
writeFileSync('convex-start.json', JSON.stringify({ args: process.argv.slice(2), agentMode: process.env.CONVEX_AGENT_MODE ?? '' }))
let local = ''
try { local = readFileSync('.env.local', 'utf8') } catch {}
if (!local.includes('CONVEX_URL=')) {
  setTimeout(() => appendFileSync('.env.local', 'CONVEX_DEPLOYMENT=anonymous:anonymous-app\\nCONVEX_URL=http://127.0.0.1:3210\\n'), 300)
}
process.on('SIGTERM', () => process.exit(0))
setInterval(() => {}, 1000)
`
const FAKE_NUXT = `import { writeFileSync } from 'node:fs'
writeFileSync('nuxt-start.json', JSON.stringify({ args: process.argv.slice(2), url: process.env.CONVEX_URL ?? '', site: process.env.SITE_URL ?? '', deployment: process.env.CONVEX_DEPLOYMENT ?? '' }))
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
      name: 'uses the deployment that .env.local selects',
      envLocal:
        'CONVEX_DEPLOYMENT=local:local-team-app\nCONVEX_URL=http://127.0.0.1:3210\nSITE_URL=http://localhost:3000\n',
      convex: { args: ['dev'], agentMode: '' },
      site: 'http://localhost:3000',
    },
  ])('$name, then starts Nuxt with the URL', async ({ envLocal, convex, site }) => {
    const cwd = mkdtempSync(join(tmpdir(), 'bcn-dev-command-'))
    try {
      mkdirSync(join(cwd, 'node_modules/convex/bin'), { recursive: true })
      mkdirSync(join(cwd, 'node_modules/nuxt/bin'), { recursive: true })
      writeFileSync(join(cwd, 'node_modules/convex/bin/main.js'), FAKE_CONVEX)
      writeFileSync(join(cwd, 'node_modules/nuxt/bin/nuxt.mjs'), FAKE_NUXT)
      writeFileSync(join(cwd, 'package.json'), '{"type":"module"}')
      if (envLocal) writeFileSync(join(cwd, '.env.local'), envLocal, { mode: 0o600 })

      // Nuxt exits on its own here, so dev stops Convex and returns Nuxt's status.
      await expect(runDevCommand(['--port', '3001'], { cwd })).resolves.toBe(0)

      const convexStart = JSON.parse(readFileSync(join(cwd, 'convex-start.json'), 'utf8'))
      expect(convexStart).toEqual(convex)
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
  })

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
