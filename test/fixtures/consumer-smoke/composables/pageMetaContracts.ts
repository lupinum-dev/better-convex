import type { PageMeta } from '#app'
import { definePageMeta } from '#app/composables/pages'

/**
 * Route-protection page metadata is typed by the module's generated
 * `types/better-convex-page-meta.d.ts`, which `.nuxt/nuxt.d.ts` must reference.
 * Without that reference `convexAuth` falls back to the `unknown` index
 * signature of `PageMeta`, and the `@ts-expect-error` lines below fail
 * `check:consumer-smoke`. Never invoked.
 */
function _pageMetaContracts() {
  definePageMeta({ convexAuth: true })
  definePageMeta({ convexAuth: false })
  definePageMeta({ convexAuth: {} })
  definePageMeta({ convexAuth: { redirectTo: '/auth/signin' } })
  definePageMeta({ convexAuth: { redirectTo: { path: '/auth/signin', query: { next: '/app' } } } })
  // @ts-expect-error redirectTo is a route location, not a number
  definePageMeta({ convexAuth: { redirectTo: 1 } })
  // @ts-expect-error convexAuth is a boolean or an options object
  definePageMeta({ convexAuth: 'required' })

  const protectedPage: PageMeta = { convexAuth: { redirectTo: '/auth/signin' } }
  // @ts-expect-error the PageMeta type itself carries the convexAuth contract
  const invalidPage: PageMeta = { convexAuth: { redirectTo: 1 } }
  return [protectedPage, invalidPage]
}
void _pageMetaContracts
