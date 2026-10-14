import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const outputDir = mkdtempSync(join(tmpdir(), 'bcn-devtools-'))
writeFileSync(join(outputDir, 'index.html'), '<p>built</p>')
vi.mock('nuxt/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuxt/server')>()),
  useRuntimeConfig: () => ({
    convexDevtoolsPath: outputDir,
    app: {},
    public: {},
  }),
}))

const { default: handler } = await import('../../src/runtime/devtools/server')

function devtoolsEvent(path: string) {
  return {
    req: new Request(`http://localhost:3000/__convex_devtools__${path}`),
    res: { headers: new Headers() },
    context: {},
  } as unknown as Parameters<typeof handler>[0]
}

// `import.meta.dev` is not defined under vitest (falsy), so this file covers the
// production branch. The dev branches are not reachable from a unit test here.
describe('devtools server handler', () => {
  // Wrong behaviour caught: a production build serving the devtools UI or the
  // auth proxy stats (request paths, statuses) to anyone who asks.
  it.each(['/', '/index.html', '/proxy-stats', '/../secret.txt'])(
    'answers %s with a 404 outside development',
    async (path) => {
      const event = devtoolsEvent(path)
      await expect(handler(event)).rejects.toMatchObject({ status: 404 })
      expect([...event.res.headers.keys()]).toEqual([])
    },
  )
})
