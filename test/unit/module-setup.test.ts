import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModuleOptions } from '../../src/module'
import { normalizeConvexRuntimeConfig } from '../../src/runtime/utils/runtime-config-normalize'

interface RegisteredTemplate {
  filename: string
  getContents?: () => string
}

const kit = vi.hoisted(() => ({
  templates: [] as RegisteredTemplate[],
  typeTemplates: [] as RegisteredTemplate[],
  warn: vi.fn(),
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
  addServerPlugin: vi.fn(),
  addRouteMiddleware: vi.fn(),
  resolvePath: vi.fn(async (path: string) => path),
  useLogger: () => ({ warn: kit.warn, info: vi.fn() }),
}))

// eslint-disable-next-line import/first
import { addPlugin } from '@nuxt/kit'

// eslint-disable-next-line import/first
import convexModule from '../../src/module'

interface TestNuxt {
  options: {
    rootDir: string
    srcDir: string
    buildDir: string
    dev: boolean
    alias: Record<string, string>
    runtimeConfig: { public: Record<string, unknown> }
  }
  hook: (name: string, callback: (payload: never) => unknown) => void
  prepareTypes: () => { references: Array<{ path?: string }> }
}

function createNuxt(): TestNuxt {
  const prepareTypeHooks: Array<(payload: never) => unknown> = []
  return {
    options: {
      rootDir: '/app',
      srcDir: '/app',
      buildDir: '/app/.nuxt',
      dev: false,
      alias: {},
      runtimeConfig: { public: {} },
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
): Promise<TestNuxt> {
  const nuxt = createNuxt()
  Object.assign(nuxt.options.runtimeConfig.public, publicRuntimeConfig)
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
