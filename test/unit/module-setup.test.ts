import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModuleOptions } from '../../src/module'
import { findAuthCachedRoutePatterns } from '../../src/module-route-rules'
import { normalizeConvexRuntimeConfig } from '../../src/runtime/utils/runtime-config-normalize'

interface RegisteredTemplate {
  filename: string
  getContents?: () => string
}

const kit = vi.hoisted(() => ({
  templates: [] as RegisteredTemplate[],
  typeTemplates: [] as RegisteredTemplate[],
  warn: vi.fn(),
  runtimeConfig: { public: {} } as { public: Record<string, unknown> },
  createBetterConvex: vi.fn(() => ({
    attachment: () => ({ identity: { subscribe: () => () => {} } }),
  })),
}))

vi.mock('#app', () => ({
  defineNuxtPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => kit.runtimeConfig,
  useState: (_key: string, init: () => unknown) => ({ value: init() }),
}))

vi.mock('@lupinum/better-convex-vue', () => ({
  createBetterConvex: kit.createBetterConvex,
}))

vi.mock('@nuxt/kit', () => ({
  defineNuxtModule: (definition: unknown) => definition,
  createResolver: () => ({ resolve: (...parts: string[]) => parts.join('/') }),
  addTemplate: (template: RegisteredTemplate) => {
    kit.templates.push(template)
    return { ...template, dst: `/app/.nuxt/${template.filename}` }
  },
  addTypeTemplate: (template: RegisteredTemplate) => {
    kit.typeTemplates.push(template)
    return { ...template, dst: `/app/.nuxt/${template.filename}` }
  },
  addPlugin: vi.fn(),
  addImports: vi.fn(),
  addServerHandler: vi.fn(),
  addServerImports: vi.fn(),
  addNitroPlugin: vi.fn(),
  addRouteMiddleware: vi.fn(),
  resolvePath: vi.fn(async (path: string) => path),
  useLogger: () => ({ warn: kit.warn, info: vi.fn() }),
}))

// eslint-disable-next-line import/first
import { addNitroPlugin, addPlugin, addServerHandler } from '@nuxt/kit'

// eslint-disable-next-line import/first
import convexModule from '../../src/module'

interface TestNuxt {
  options: {
    rootDir: string
    srcDir: string
    buildDir: string
    dev: boolean
    alias: Record<string, string>
    build: { transpile: string[] }
    runtimeConfig: { public: Record<string, unknown>; convex?: Record<string, unknown> }
    routeRules: Record<string, unknown>
    nitro: { routeRules?: Record<string, unknown> }
  }
  hook: (name: string, callback: (payload: never) => unknown) => void
  prepareTypes: () => { references: Array<{ path?: string }> }
}

function createNuxt(dev = false): TestNuxt {
  const prepareTypeHooks: Array<(payload: never) => unknown> = []
  return {
    options: {
      rootDir: '/app',
      srcDir: '/app',
      buildDir: '/app/.nuxt',
      dev,
      alias: {},
      build: { transpile: [] },
      runtimeConfig: { public: {} },
      routeRules: {},
      nitro: {},
    },
    hook(name, callback) {
      if (name === 'prepare:types') prepareTypeHooks.push(callback)
    },
    prepareTypes() {
      const payload = { references: [] as Array<{ path?: string }>, tsConfig: {} }
      for (const hook of prepareTypeHooks) hook(payload as never)
      return payload
    },
  }
}

async function setup(
  options: ModuleOptions,
  publicRuntimeConfig: Record<string, unknown> = {},
  dev = false,
  routeRules: Record<string, unknown> = {},
): Promise<TestNuxt> {
  const nuxt = createNuxt(dev)
  Object.assign(nuxt.options.runtimeConfig.public, publicRuntimeConfig)
  Object.assign(nuxt.options.routeRules, routeRules)
  const definition = convexModule as unknown as {
    setup: (options: ModuleOptions, nuxt: TestNuxt) => Promise<void>
  }
  await definition.setup({ url: 'https://example.convex.cloud', logging: false, ...options }, nuxt)
  return nuxt
}

function publicConvex(nuxt: TestNuxt) {
  return nuxt.options.runtimeConfig.public.convex as Record<string, unknown>
}

beforeEach(() => {
  kit.templates.length = 0
  kit.typeTemplates.length = 0
})

describe('module type templates', () => {
  it('registers every auth-enabled declaration as a referenced type template', async () => {
    const nuxt = await setup({ auth: { origin: 'http://localhost:3000' } })

    expect(kit.typeTemplates.map((template) => template.filename).sort()).toEqual([
      'types/better-convex-auth-client.d.ts',
      'types/better-convex-client-activation.d.ts',
      'types/better-convex-page-meta.d.ts',
      'types/better-convex-route-rules.d.ts',
    ])
    // A plain template is never referenced from `.nuxt/nuxt.d.ts`, so no
    // declaration may be registered that way.
    expect(kit.templates.filter((template) => template.filename.endsWith('.d.ts'))).toEqual([])
    for (const template of [...kit.templates, ...kit.typeTemplates]) {
      expect(template.filename).toMatch(/^[\w@./-]+$/u)
    }

    const pageMeta = kit.typeTemplates.find(
      (template) => template.filename === 'types/better-convex-page-meta.d.ts',
    )
    expect(pageMeta?.getContents?.()).toContain('convexAuth?: ConvexAuthPageMeta')
    // The module itself adds no reference to a file no template generates.
    expect(nuxt.prepareTypes().references).toEqual([])
  })

  it('generates no auth declaration for a Convex-only build', async () => {
    await setup({})

    expect(kit.typeTemplates.map((template) => template.filename)).toEqual([
      'types/better-convex-client-activation.d.ts',
    ])
    expect(kit.templates.map((template) => template.filename)).toEqual([
      '@lupinum/better-convex-nuxt/convex-api-missing.ts',
      '@lupinum/better-convex-nuxt/client-activation.mjs',
    ])
  })
})

describe('module trusted client IP header', () => {
  it('keeps the header out of the public runtime config and in the server-only one', async () => {
    const nuxt = await setup({
      auth: { origin: 'https://app.example.test', trustedClientIpHeader: 'CF-Connecting-IP' },
    })

    expect(JSON.stringify(nuxt.options.runtimeConfig.public)).not.toMatch(
      /cf-connecting-ip|trustedClientIpHeader/iu,
    )
    expect(nuxt.options.runtimeConfig.convex).toEqual({ trustedClientIpHeader: 'cf-connecting-ip' })

    // Server code recombines both halves; the browser never sees the header.
    const server = normalizeConvexRuntimeConfig(
      publicConvex(nuxt),
      nuxt.options.runtimeConfig.convex,
    )
    if (server.auth === false) throw new Error('expected auth enabled')
    expect(server.auth.trustedClientIpHeader).toBe('cf-connecting-ip')
    const browser = normalizeConvexRuntimeConfig(publicConvex(nuxt))
    if (browser.auth === false) throw new Error('expected auth enabled')
    expect(browser.auth.trustedClientIpHeader).toBe('')
  })

  it('does not let a public runtime override supply the header', async () => {
    const nuxt = await setup({
      auth: { origin: 'https://app.example.test', trustedClientIpHeader: 'cf-connecting-ip' },
    })
    const tampered = {
      ...publicConvex(nuxt),
      auth: { ...(publicConvex(nuxt).auth as object), trustedClientIpHeader: 'x-forged-ip' },
    }
    const config = normalizeConvexRuntimeConfig(tampered, nuxt.options.runtimeConfig.convex)
    if (config.auth === false) throw new Error('expected auth enabled')
    expect(config.auth.trustedClientIpHeader).toBe('cf-connecting-ip')
  })

  it('fails closed on the server when a non-loopback origin has no header', async () => {
    expect(() =>
      normalizeConvexRuntimeConfig({ auth: { origin: 'https://app.example.test' } }, {}),
    ).toThrow('trustedClientIpHeader is required')
  })
})

describe('module loopback production origin', () => {
  const loopbackWarning = () =>
    kit.warn.mock.calls.some(([message]) => String(message).includes('loopback auth origin'))

  it.each([
    ['production build', false, true],
    ['dev server', true, false],
  ])('warns about a loopback auth origin in a %s: %s', async (_, dev, warns) => {
    kit.warn.mockClear()
    await setup({ auth: { origin: 'http://localhost:3000' } }, {}, dev)
    expect(loopbackWarning()).toBe(warns)
  })

  it('stays quiet for a public production origin', async () => {
    kit.warn.mockClear()
    await setup({
      auth: { origin: 'https://app.example.test', trustedClientIpHeader: 'cf-connecting-ip' },
    })
    expect(loopbackWarning()).toBe(false)
  })
})

describe('module Convex URL', () => {
  it.each([
    [{ url: undefined }, {}, true],
    [{ url: 'https://demo.convex.cloud' }, {}, false],
    [{ url: undefined }, { convex: { url: 'https://demo.convex.cloud' } }, false],
  ] as const)('warns about a missing deployment URL: %o %o', async (options, runtime, warns) => {
    kit.warn.mockClear()
    await setup(options, runtime)
    expect(
      kit.warn.mock.calls.some(([message]) => String(message).includes('NUXT_PUBLIC_CONVEX_URL')),
    ).toBe(warns)
  })
})

describe('module site URL', () => {
  it('derives the site URL from a deploy-time URL override, but keeps an explicit one', async () => {
    const derived = publicConvex(await setup({ url: 'https://old.convex.cloud' }))
    expect(
      normalizeConvexRuntimeConfig({ ...derived, url: 'https://new.convex.cloud' }).siteUrl,
    ).toBe('https://new.convex.site')

    const explicit = publicConvex(
      await setup({ url: 'https://old.convex.cloud', siteUrl: 'https://auth.example.test' }),
    )
    expect(
      normalizeConvexRuntimeConfig({ ...explicit, url: 'https://new.convex.cloud' }).siteUrl,
    ).toBe('https://auth.example.test')
  })
})

describe('module transport options', () => {
  it('does not lose experimental.keepAlive between module setup and createBetterConvex', async () => {
    const nuxt = await setup({ experimental: { keepAlive: { ms: 60_000, max: 30 } } })
    kit.runtimeConfig = nuxt.options.runtimeConfig
    kit.createBetterConvex.mockClear()
    const { setupConvexBrowserRuntime } = await import('../../src/runtime/plugin.client')
    const app = { provide: vi.fn(), vueApp: { use: vi.fn(), onUnmount: vi.fn() } }
    setupConvexBrowserRuntime(app as never)

    expect(kit.createBetterConvex).toHaveBeenCalledExactlyOnceWith({
      convexUrl: 'https://example.convex.cloud',
      clientOptions: {},
      experimental: { keepAlive: { ms: 60_000, max: 30 } },
    })
    expect(publicConvex(await setup({})).experimental).toStrictEqual({})
  })

  it('materializes client options and server bounds with the documented defaults', async () => {
    const defaults = publicConvex(await setup({}))
    expect(defaults.client).toEqual({})
    expect(defaults.server).toEqual({ maxResponseBytes: 1_048_576, queryTimeoutMs: 8_000 })

    const configured = publicConvex(
      await setup({
        client: { verbose: true, skipConvexDeploymentUrlCheck: true, unsavedChangesWarning: true },
        server: { maxResponseBytes: 4_194_304, queryTimeoutMs: 15_000 },
      }),
    )
    expect(configured.client).toEqual({
      verbose: true,
      skipConvexDeploymentUrlCheck: true,
      unsavedChangesWarning: true,
    })
    expect(configured.server).toEqual({ maxResponseBytes: 4_194_304, queryTimeoutMs: 15_000 })
  })

  // The full validation table lives in runtime-config.test.ts (same normalizers).
  it.each([
    [{ client: { webSocketConstructor: 'ws' } }, 'client.webSocketConstructor is not a supported'],
    [{ server: { queryTimeoutMs: -1 } }, 'server.queryTimeoutMs must be a positive integer'],
    [
      { experimental: { keepAlive: { ms: 0, max: 30 } } },
      'keepAlive.ms and experimental.keepAlive.max must be positive safe integers',
    ],
  ])('rejects invalid transport options at build time: %j', async (options, message) => {
    await expect(setup(options as ModuleOptions)).rejects.toThrow(message)
  })
})

describe('module client.connect', () => {
  const clientPlugins = () =>
    vi
      .mocked(addPlugin)
      .mock.calls.map(([plugin]) => plugin)
      .filter((plugin) => typeof plugin === 'object' && plugin.mode === 'client')

  beforeEach(() => {
    vi.mocked(addPlugin).mockClear()
  })

  it.each([
    [{}, './runtime/plugin.client'],
    [{ auth: { origin: 'http://localhost:3000' } }, './runtime/plugin.auth.client'],
  ] as const)(
    'installs the one browser runtime as a client plugin when eager: %j',
    async (options, path) => {
      const nuxt = await setup(options as ModuleOptions)
      expect(clientPlugins()).toEqual([{ src: path, mode: 'client' }])
      expect(publicConvex(nuxt).client).toEqual({})
      const activation = kit.templates.find((template) =>
        template.filename.endsWith('client-activation.mjs'),
      )
      expect(activation?.getContents?.()).toContain('loadBrowserRuntime = null')
    },
  )

  it('installs no client plugin and loads the runtime on activation when on-demand', async () => {
    const nuxt = await setup({
      auth: { origin: 'http://localhost:3000' },
      client: { connect: 'on-demand', verbose: true },
    })
    expect(clientPlugins()).toEqual([])
    // `connect` is build policy; only ConvexClient options reach runtime config.
    expect(publicConvex(nuxt).client).toEqual({ verbose: true })
    const activation = kit.templates.find((template) =>
      template.filename.endsWith('client-activation.mjs'),
    )
    expect(activation?.getContents?.()).toContain("import('#convex/browser-runtime')")
    expect(nuxt.options.alias['#convex/browser-runtime']).toBe('./runtime/plugin.auth.client')
    expect(nuxt.options.alias['#convex/client-activation']).toBe(
      '/app/.nuxt/@lupinum/better-convex-nuxt/client-activation.mjs',
    )
  })

  it('rejects an unknown connect mode', async () => {
    await expect(setup({ client: { connect: 'lazy' as never } })).rejects.toThrow(
      "client.connect must be 'eager' or 'on-demand'",
    )
  })
})

describe('module server registrations', () => {
  // Catches a lost auth proxy route or a registration of a deleted server plugin (the Nitro
  // build fails on a missing file). The bare base paths come from the `/**` routes.
  it('registers the auth proxy routes, the devtools route and the route-rule Nitro plugin', async () => {
    vi.mocked(addServerHandler).mockClear()
    vi.mocked(addNitroPlugin).mockClear()
    await setup({ auth: { origin: 'http://localhost:3000' } }, {}, true)

    expect(vi.mocked(addServerHandler).mock.calls.map(([handler]) => handler.route)).toEqual([
      '/api/auth/jwks',
      '/api/auth/**',
      '/.well-known/oauth-authorization-server/api/auth',
      '/__convex_devtools__/**',
    ])
    expect(vi.mocked(addNitroPlugin).mock.calls).toEqual([
      ['./runtime/server/plugins/ssr-auth-route'],
    ])
  })
})

describe('module cached auth route warning', () => {
  // Catches a cache rule on a signed-in SSR page going unreported (it overrides the private/Vary
  // headers), and false alarms for API, asset and anonymous routes, including routes that a
  // broader `convex: { ssrAuth: false }` pattern covers.
  it.each([
    [
      'swr, cache and isr on pages',
      { '/blog/**': { swr: 60 }, '/': { cache: { maxAge: 60 } }, '/docs/**': { isr: true } },
      undefined,
      true,
      ['/blog/**', '/', '/docs/**'],
    ],
    [
      'disabled caches',
      { '/a': { isr: false }, '/b': { cache: false }, '/c': { swr: 0 } },
      undefined,
      true,
      [],
    ],
    [
      'cache headers in any case',
      {
        '/h1': { headers: { 'Cache-Control': 's-maxage=60' } },
        '/h2': { headers: { 'Vercel-CDN-Cache-Control': 'max-age=60' } },
        '/h3': { headers: { vary: 'accept-language' } },
        '/h4': { headers: { 'CDN-Cache-Control': 'max-age=60' } },
        '/h5': { headers: { 'Surrogate-Control': 'max-age=60' } },
        '/h6': { headers: { 'Edge-Control': 'cache-maxage=60' } },
        '/h7': { headers: { 'X-Accel-Expires': '60' } },
        '/h8': { headers: { 'x-frame-options': 'DENY' } },
      },
      undefined,
      true,
      ['/h1', '/h2', '/h3', '/h4', '/h5', '/h6', '/h7'],
    ],
    [
      'API, build asset and internal routes',
      {
        '/api/**': { swr: 60 },
        '/api': { cache: {} },
        '/_nuxt/**': { headers: { 'cache-control': 'immutable' } },
        '/__og/**': { swr: true },
        '/apidocs/**': { swr: 60 },
      },
      undefined,
      true,
      ['/apidocs/**'],
    ],
    [
      'a rule that turns SSR auth off',
      { '/blog/**': { swr: 60, convex: { ssrAuth: false } } },
      undefined,
      true,
      [],
    ],
    ['SSR auth off by default', { '/blog/**': { swr: 60 } }, undefined, false, []],
    [
      'a rule that turns SSR auth on',
      { '/blog/**': { swr: 60, convex: { ssrAuth: true } } },
      undefined,
      false,
      ['/blog/**'],
    ],
    ['Nitro route rules', {}, { '/n/**': { swr: 60 } }, true, ['/n/**']],
    [
      'ssrAuth off in nuxt rules, cache in Nitro rules',
      { '/m/**': { convex: { ssrAuth: false } } },
      { '/m/**': { swr: 60 } },
      true,
      ['/m/**'],
    ],
    [
      'cache in nuxt rules, ssrAuth off in Nitro rules',
      { '/k/**': { swr: 60 } },
      { '/k/**': { convex: { ssrAuth: false } } },
      true,
      [],
    ],
    [
      'covered by /** with SSR auth off',
      { '/**': { convex: { ssrAuth: false } }, '/blog/**': { swr: 60 }, '/about': { isr: 60 } },
      undefined,
      true,
      [],
    ],
    [
      'covered by /blog/** with SSR auth off',
      { '/blog/**': { convex: { ssrAuth: false } }, '/blog/x': { swr: 60 } },
      undefined,
      true,
      [],
    ],
    [
      'own SSR auth on under /** with SSR auth off',
      {
        '/**': { convex: { ssrAuth: false } },
        '/admin/**': { swr: 60, convex: { ssrAuth: true } },
      },
      undefined,
      true,
      ['/admin/**'],
    ],
    [
      'not covered by a rule with SSR auth off',
      { '/blog/**': { convex: { ssrAuth: false } }, '/blogs': { swr: 60 }, '/docs': { isr: 60 } },
      undefined,
      true,
      ['/blogs', '/docs'],
    ],
  ] as const)('%s', (_, routeRules, nitroRouteRules, ssrDefault, expected) => {
    expect(findAuthCachedRoutePatterns([routeRules, nitroRouteRules], ssrDefault)).toEqual(expected)
  })

  it('logs one warning that lists every pattern, and none without auth', async () => {
    const cacheWarnings = () =>
      kit.warn.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes('convex: { ssrAuth: false }'))
    const routeRules = { '/blog/**': { swr: 60 }, '/**': { headers: { vary: 'accept-language' } } }

    kit.warn.mockClear()
    await setup(
      { auth: { origin: 'https://app.example.test', trustedClientIpHeader: 'cf-connecting-ip' } },
      {},
      false,
      routeRules,
    )
    expect(cacheWarnings()).toHaveLength(1)
    expect(cacheWarnings()[0]).toContain('Route rules "/blog/**", "/**" cache pages')

    kit.warn.mockClear()
    // A rule that turns SSR auth on explicitly: without the auth guard it would warn.
    await setup({}, {}, false, { ...routeRules, '/x': { swr: 60, convex: { ssrAuth: true } } })
    expect(cacheWarnings()).toEqual([])
  })
})
