import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import type { ConvexAuthPageMeta } from '../../src/runtime/utils/auth-route-protection'
import type { ConvexAuthStatus } from '../../src/runtime/utils/auth-status'
import { AUTH_UNAVAILABLE_MESSAGE } from '../../src/runtime/utils/convex-shared'

const { navigateToMock, runtimeConfig, authState, serverRender } = vi.hoisted(() => ({
  serverRender: { event: undefined as { context: object } | undefined },
  navigateToMock: vi.fn((target: unknown) => ({ navigatedTo: target })),
  runtimeConfig: { public: { convex: {} as Record<string, unknown> } },
  authState: {
    status: 'anonymous' as string,
    pending: false,
    readyStatus: 'anonymous' as string,
    errorMessage: null as string | null,
  },
}))

vi.mock('#app', () => ({
  defineNuxtRouteMiddleware: (middleware: unknown) => middleware,
  navigateTo: navigateToMock,
  useRequestEvent: () => serverRender.event,
  useRuntimeConfig: () => runtimeConfig,
}))

vi.mock('../../src/runtime/composables/useConvexActivation', () => ({
  useConvexActivation: () => ({ activate: async () => {} }),
}))

vi.mock('../../src/runtime/utils/runtime-config', async () => ({
  ...(await import('../../src/runtime/utils/runtime-config-normalize')),
}))

vi.mock('../../src/runtime/composables/useConvexAuth', () => ({
  useConvexAuth: () => ({
    status: computed(() => authState.status),
    pending: ref(authState.pending),
    error: computed(() =>
      authState.errorMessage ? { message: authState.errorMessage } : undefined,
    ),
    ready: vi.fn(async () => authState.readyStatus),
  }),
}))

type Middleware = (to: {
  path: string
  fullPath: string
  query: Record<string, unknown>
  meta: { convexAuth?: ConvexAuthPageMeta }
}) => Promise<unknown>

async function loadMiddleware(): Promise<Middleware> {
  return (await import('../../src/runtime/middleware/convex-auth.global')).default as Middleware
}

function route(path: string, convexAuth?: ConvexAuthPageMeta, query: Record<string, unknown> = {}) {
  const search = new URLSearchParams(
    Object.entries(query).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString()
  return {
    path,
    fullPath: search ? `${path}?${search}` : path,
    query,
    meta: convexAuth === undefined ? {} : { convexAuth },
  }
}

function configure(auth: Record<string, unknown> | false) {
  runtimeConfig.public.convex = {
    url: 'https://demo.convex.cloud',
    auth: auth === false ? false : { origin: 'http://localhost:3000', ...auth },
  }
}

function signedIn(status: ConvexAuthStatus) {
  authState.status = status
  authState.readyStatus = status
  authState.pending = false
  authState.errorMessage = null
}

describe('convex-auth route middleware', () => {
  beforeEach(() => {
    navigateToMock.mockClear()
    configure({})
    signedIn('anonymous')
    serverRender.event = undefined
  })

  // A signed-in person whose server-side token exchange failed temporarily
  // arrives as status 'error'. A definitive miss (no cookie, 401) arrives as
  // 'anonymous' and still redirects.
  it('does not send a signed-in person to sign-in when the server exchange failed temporarily', async () => {
    serverRender.event = { context: {} }
    signedIn('error')
    authState.errorMessage = AUTH_UNAVAILABLE_MESSAGE
    const middleware = await loadMiddleware()
    await expect(middleware(route('/dashboard', true))).resolves.toBeUndefined()
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('still sends a visitor to sign-in when server auth failed for another reason', async () => {
    serverRender.event = { context: {} }
    signedIn('error')
    authState.errorMessage = 'Convex site URL is missing'
    const middleware = await loadMiddleware()
    await middleware(route('/dashboard', true))
    expect(navigateToMock).toHaveBeenCalledWith('/auth/signin?redirect=%2Fdashboard')
  })

  it('still sends a definitively signed-out visitor to sign-in during server rendering', async () => {
    serverRender.event = { context: {} }
    signedIn('anonymous')
    const middleware = await loadMiddleware()
    await middleware(route('/dashboard', true))
    expect(navigateToMock).toHaveBeenCalledWith('/auth/signin?redirect=%2Fdashboard')
  })

  it('leaves unannotated pages public by default', async () => {
    const middleware = await loadMiddleware()
    await expect(middleware(route('/dashboard'))).resolves.toBeUndefined()
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('protects unannotated pages when routes default to protected', async () => {
    configure({ routes: 'protected' })
    const middleware = await loadMiddleware()
    await middleware(route('/dashboard'))
    expect(navigateToMock).toHaveBeenCalledWith('/auth/signin?redirect=%2Fdashboard')

    navigateToMock.mockClear()
    await middleware(route('/pricing', false))
    await middleware(route('/auth/signin'))
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('lets a signed-in user through a protected page', async () => {
    signedIn('authenticated')
    const middleware = await loadMiddleware()
    await middleware(route('/dashboard', true))
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('sends a signed-in user away from a guest page to the validated return path', async () => {
    signedIn('authenticated')
    const middleware = await loadMiddleware()
    await middleware(route('/auth/signin', 'guest', { redirect: '/dashboard?tab=team' }))
    expect(navigateToMock).toHaveBeenCalledWith('/dashboard?tab=team')
  })

  it.each([
    undefined,
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    '/%2F%2Fevil.example',
  ])('uses guestRedirectTo for the missing or unsafe return path %s', async (redirect) => {
    configure({ guestRedirectTo: '/app' })
    signedIn('authenticated')
    const middleware = await loadMiddleware()
    await middleware(route('/auth/signin', 'guest', redirect ? { redirect } : {}))
    expect(navigateToMock).toHaveBeenCalledExactlyOnceWith('/app')
  })

  it('lets signed-out and errored visitors use a guest page', async () => {
    const middleware = await loadMiddleware()
    await middleware(route('/auth/signin', 'guest', { redirect: '/dashboard' }))
    signedIn('error')
    await middleware(route('/auth/signin', 'guest'))
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('does nothing in a no-auth build', async () => {
    configure(false)
    const middleware = await loadMiddleware()
    await middleware(route('/dashboard', true))
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
