import { trusted } from '@lupinum/better-convex-functions'
import { unguardedFunctions } from '@lupinum/better-convex-functions/test'
import { httpActionGeneric, httpRouter, internalQueryGeneric, queryGeneric } from 'convex/server'
import { expect, test } from 'vitest'

const raw = () => queryGeneric({ args: {}, handler: async () => null })
const rawHttp = () => httpActionGeneric(async () => new Response('leak'))

// Catches: raw functions in nested modules, raw internal functions an operation could reach,
// and raw handlers on the router.
test('raw functions are found in any module, router routes included', () => {
  const http = httpRouter()
  http.route({ path: '/leak', method: 'GET', handler: rawHttp() })
  http.route({ path: '/api/auth/session', method: 'GET', handler: rawHttp() })
  http.route({
    pathPrefix: '/files/',
    method: 'GET',
    handler: trusted('Signed URLs only.', rawHttp()),
  })
  const modules = {
    '../convex/admin/leak.ts': { read: raw(), ok: trusted('Health check.', raw()) },
    '../convex/admin/internal.ts': { rawRead: internalQueryGeneric({ handler: async () => null }) },
    '../convex/http.ts': { default: http },
  }
  expect(unguardedFunctions(modules, { trustedRoutes: { '/api/auth/': 'Auth library.' } })).toEqual(
    [
      '../convex/admin/leak.ts:read',
      '../convex/admin/internal.ts:rawRead',
      '../convex/http.ts:GET /leak',
    ],
  )
})

// A live deploy refused a union as a function's top-level args; convex-test accepts it.
test('every registered function takes an object or any as its arguments, as a deploy requires', async () => {
  const modules = import.meta.glob<Record<string, unknown>>(
    ['./**/*.ts', '!./**/*.test.ts', '!./_generated/**', '!./*/_generated/**'],
    { eager: true },
  )
  const bad = Object.entries(modules).flatMap(([path, exports]) =>
    Object.entries(exports).flatMap(([name, fn]) => {
      const exportArgs = (fn as { exportArgs?: () => string } | null)?.exportArgs
      if (typeof exportArgs !== 'function') return []
      const type = JSON.parse(exportArgs.call(fn)).type
      return type === 'object' || type === 'any' ? [] : [`${path}:${name}`]
    }),
  )
  expect(bad).toEqual([])
})
