// `.env.local` can outlive a removed `.convex`. To the Convex CLI that is a new deployment, and
// it generates the keys of a new deployment with the newest backend it can download.
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { startLocalConvexBackend } from '../helpers/local-convex'
import { availablePort, root } from './harness'

it('starts a saved selection without local state on a deployment the harness creates', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'bcn-saved-selection-'))
  const cloud = await availablePort()
  const site = await availablePort(new Set([cloud]))
  await symlink(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir')
  await mkdir(join(cwd, 'convex'))
  await writeFile(
    join(cwd, 'package.json'),
    '{"private":true,"type":"module","dependencies":{"convex":"*"}}\n',
  )
  await writeFile(
    join(cwd, '.env.local'),
    `CONVEX_DEPLOYMENT=anonymous:anonymous-agent\nCONVEX_URL=http://127.0.0.1:${cloud}\nCONVEX_SITE_URL=http://127.0.0.1:${site}\n`,
  )

  const backend = await startLocalConvexBackend({
    cwd,
    timeoutMs: 120_000,
    devArguments: ['--tail-logs', 'disable', '--typecheck', 'disable'],
  })
  try {
    // A deployment the CLI creates gets the CLI's default ports and a world-readable key file.
    expect(backend.url).toBe(`http://127.0.0.1:${cloud}`)
    const config = await stat(join(cwd, '.convex/local/default/config.json'))
    expect(config.mode & 0o777).toBe(0o600)
  } finally {
    await backend.release()
    await rm(cwd, { force: true, recursive: true })
  }
})
