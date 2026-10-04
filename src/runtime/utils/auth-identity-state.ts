import type { Ref } from 'vue'

import type { NuxtApp } from '#app'
import { useState } from '#imports'

import { ANONYMOUS_IDENTITY, LOADING_IDENTITY, type AuthIdentity } from '../auth/auth-identity'

/** The single SSR-hydrated identity value used by every runtime auth reader. */
export function useConvexIdentityState(): Ref<AuthIdentity> {
  return useState<AuthIdentity>('convex:identity', () =>
    import.meta.client ? LOADING_IDENTITY : ANONYMOUS_IDENTITY,
  )
}

// The Convex JWT exchanged for this server render. It stays out of
// `useState`, so it never reaches the page payload; the browser fetches its own.
const serverTokens = new WeakMap<NuxtApp, string>()

export function setServerConvexToken(nuxtApp: NuxtApp, token: string | null): void {
  if (token) serverTokens.set(nuxtApp, token)
  else serverTokens.delete(nuxtApp)
}

export function readServerConvexToken(nuxtApp: NuxtApp): string | null {
  return serverTokens.get(nuxtApp) ?? null
}
