import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { useConvexAuthReturnTo } from '../../src/runtime/composables/useConvexAuthReturnTo'

const { route } = vi.hoisted(() => ({
  route: { query: {} as Record<string, unknown> },
}))
const reactiveRoute = reactive(route)

mockNuxtImport('useRoute', () => () => reactiveRoute)

describe('useConvexAuthReturnTo', () => {
  it('exposes the validated return path and tracks the route', () => {
    reactiveRoute.query = { redirect: '/dashboard?tab=team' }
    const returnTo = useConvexAuthReturnTo()
    expect(returnTo.value).toBe('/dashboard?tab=team')

    reactiveRoute.query = { redirect: '/team/../settings#profile' }
    expect(returnTo.value).toBe('/settings#profile')

    reactiveRoute.query = {}
    expect(returnTo.value).toBeNull()
  })

  it.each([
    '//evil.example',
    '/\\evil.example',
    '/%2F%2Fevil.example',
    '/%5Cevil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/safe%0d%0aforged',
    ['/dashboard', '//evil.example'],
  ])('rejects an unsafe return path: %j', (redirect) => {
    reactiveRoute.query = { redirect }
    expect(useConvexAuthReturnTo().value).toBeNull()
  })
})
