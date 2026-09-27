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
  definePageMeta({ convexAuth: 'guest' })
  // @ts-expect-error redirectTo is a route location, not a number
  definePageMeta({ convexAuth: { redirectTo: 1 } })
  // @ts-expect-error convexAuth is a boolean, 'guest', or an options object
  definePageMeta({ convexAuth: 'required' })
  // @ts-expect-error guest-only pages use the 'guest' literal, not an object flag
  definePageMeta({ convexAuth: { guest: true } })

  const protectedPage: PageMeta = { convexAuth: { redirectTo: '/auth/signin' } }
  const guestPage: PageMeta = { convexAuth: 'guest' }
  // @ts-expect-error the PageMeta type itself carries the convexAuth contract
  const invalidPage: PageMeta = { convexAuth: { redirectTo: 1 } }
  return [protectedPage, guestPage, invalidPage]
}
void _pageMetaContracts
