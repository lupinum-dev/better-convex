import { trusted } from '@lupinum/better-convex-functions'
import { unguardedFunctions } from '@lupinum/better-convex-functions/test'
import { httpActionGeneric, httpRouter, internalQueryGeneric, queryGeneric } from 'convex/server'
import { expect, test } from 'vitest'

const raw = () => queryGeneric({ args: {}, handler: async () => null })
const rawHttp = () => httpActionGeneric(async () => new Response('leak'))

// The fixture app, as an app's test.setup.ts globs it for convexTest.
const app = import.meta.glob('./app/**/*.ts')
const load = (exports: Record<string, unknown>) => async () => exports

// Catches: raw functions in nested modules, raw internal functions an operation could reach,
// raw handlers on the router, and loading files Convex does not deploy.
test('raw functions are found in any module, router routes included', async () => {
  const http = httpRouter()
  http.route({ path: '/leak', method: 'GET', handler: rawHttp() })
  http.route({ path: '/api/auth/session', method: 'GET', handler: rawHttp() })
  http.route({
    pathPrefix: '/files/',
    method: 'GET',
    handler: trusted('Signed URLs only.', rawHttp()),
  })
  const modules = {
    ...app,
    './admin/leak.ts': load({ read: raw(), ok: trusted('Health check.', raw()) }),
    './admin/internal.ts': load({ rawRead: internalQueryGeneric({ handler: async () => null }) }),
    './http.ts': load({ default: http }),
    // Convex skips these files, so the scan does too.
    './leaks.test.ts': load({ read: raw() }),
    './test.setup.ts': load({ read: raw() }),
    './_generated/server.ts': load({ read: raw() }),
  }
  expect(
    await unguardedFunctions(modules, { trustedRoutes: { '/api/auth/': 'Auth library.' } }),
  ).toEqual(['./admin/leak.ts:read', './admin/internal.ts:rawRead', './http.ts:GET /leak'])
})

// Catches a no-bypass test that passes because its glob found nothing to check.
test.each([
  [
    'an empty map',
    {},
    'unguardedFunctions found no modules. Pass the import.meta.glob map you give convexTest.',
  ],
  [
    'only files Convex skips',
    { './leaks.test.ts': load({ read: raw() }) },
    'unguardedFunctions found no modules. Pass the import.meta.glob map you give convexTest.',
  ],
  [
    'no defineFunctions operation',
    { './raw.ts': load({ read: raw() }), './other.ts': load({}) },
    'unguardedFunctions loaded 2 modules but found no defineFunctions operations. Check the glob.',
  ],
])('%s throws', async (_name, modules, message) => {
  await expect(unguardedFunctions(modules)).rejects.toThrow(new Error(message))
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
