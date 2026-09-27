import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModuleOptions } from '../../src/module'

interface RegisteredTemplate {
  filename: string
  getContents?: () => string
}

const kit = vi.hoisted(() => ({
  templates: [] as RegisteredTemplate[],
  typeTemplates: [] as RegisteredTemplate[],
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
  useLogger: () => ({ warn: vi.fn(), info: vi.fn() }),
}))

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

async function setup(options: ModuleOptions): Promise<TestNuxt> {
  const nuxt = createNuxt()
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
      'types/better-convex-page-meta.d.ts',
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

    expect(kit.typeTemplates).toEqual([])
    expect(kit.templates.map((template) => template.filename)).toEqual([
      '@lupinum/better-convex-nuxt/convex-api-missing.ts',
    ])
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

  it.each([
    [{ client: { verbose: 'yes' } }, 'client.verbose must be a boolean'],
    [{ client: { webSocketConstructor: 'ws' } }, 'client.webSocketConstructor is not a supported'],
    [{ client: { disabled: true } }, 'client.disabled is not a supported'],
    [{ server: { maxResponseBytes: 0 } }, 'server.maxResponseBytes must be a positive integer'],
    [{ server: { maxResponseBytes: 1.5 } }, 'server.maxResponseBytes must be a positive integer'],
    [{ server: { queryTimeoutMs: -1 } }, 'server.queryTimeoutMs must be a positive integer'],
    [{ server: { queryTimeoutMs: 2_147_483_648 } }, 'no greater than 2147483647'],
    [{ server: { timeoutMs: 1 } }, 'server.timeoutMs is not a supported'],
  ])('rejects invalid transport options at build time: %j', async (options, message) => {
    await expect(setup(options as ModuleOptions)).rejects.toThrow(message)
  })
})
