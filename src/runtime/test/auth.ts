import type { BetterConvexAttachment } from '@lupinum/better-convex-vue/embedded'
import { computed, readonly, shallowRef, type ComputedRef, type ShallowRef } from 'vue'

import { ConvexCallError } from '../errors'
import type { ConvexUser } from '../utils/types'

export type BetterConvexTestAuthPreset = 'authenticated' | 'anonymous' | 'loading' | 'error'

export interface BetterConvexTestAuth {
  readonly status: ComputedRef<'authenticated' | 'anonymous' | 'loading' | 'error'>
  readonly pending: ComputedRef<boolean>
  readonly user: Readonly<ShallowRef<ConvexUser | null>>
  readonly error: ComputedRef<ConvexCallError | undefined>
  readonly client: {
    readonly signIn: { email(input: Record<string, unknown>): Promise<BetterConvexTestAuthResult> }
    readonly signUp: { email(input: Record<string, unknown>): Promise<BetterConvexTestAuthResult> }
    signOut(): Promise<BetterConvexTestAuthResult>
  }
  ready(options?: {
    timeoutMs?: number
  }): Promise<'authenticated' | 'anonymous' | 'loading' | 'error'>
  signIn(user?: ConvexUser): void
  signOut(): void
  setLoading(): void
  fail(error: unknown): void
}

export interface BetterConvexTestAuthResult {
  readonly data: Record<string, never>
  readonly error: null
}

export interface BetterConvexTestAuthRuntime {
  readonly auth: BetterConvexTestAuth
  readonly observer: BetterConvexAttachment['identity']
}

const DEFAULT_USER: ConvexUser = Object.freeze({
  id: 'test-user',
  name: 'Test User',
  email: 'test@example.test',
  emailVerified: true,
})

export function createBetterConvexTestAuth(
  initial: BetterConvexTestAuthPreset | ConvexUser,
): BetterConvexTestAuthRuntime {
  let generation = 0
  const preset = shallowRef<BetterConvexTestAuthPreset>(
    typeof initial === 'string' ? initial : 'authenticated',
  )
  const currentUser = shallowRef<ConvexUser | null>(
    preset.value === 'authenticated'
      ? typeof initial === 'string'
        ? DEFAULT_USER
        : initial
      : null,
  )
  const currentError = shallowRef<ConvexCallError | undefined>(
    preset.value === 'error'
      ? new ConvexCallError({ kind: 'authentication', message: 'Test authentication failed' })
      : undefined,
  )
  const listeners = new Set<() => void>()
  const settledWaiters = new Set<() => void>()

  const waitForSettlement = (timeoutMs = 0) => {
    if (preset.value !== 'loading') return Promise.resolve()
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const settle = () => {
        if (timer !== undefined) clearTimeout(timer)
        settledWaiters.delete(settle)
        resolve()
      }
      settledWaiters.add(settle)
      if (timeoutMs > 0) timer = setTimeout(settle, timeoutMs)
    })
  }

  const notify = () => {
    for (const listener of listeners) listener()
    if (preset.value !== 'loading') {
      for (const resolve of settledWaiters) resolve()
      settledWaiters.clear()
    }
  }
  const change = (
    next: BetterConvexTestAuthPreset,
    user: ConvexUser | null,
    error?: ConvexCallError,
  ) => {
    const previousKey = currentUser.value?.id ?? 'anonymous'
    const nextKey = user?.id ?? 'anonymous'
    if (previousKey !== nextKey) generation += 1
    preset.value = next
    currentUser.value = user
    currentError.value = error
    notify()
  }

  const observer: BetterConvexAttachment['identity'] = {
    snapshot: () => ({
      authEnabled: true,
      settled: preset.value !== 'loading',
      identityKey:
        preset.value === 'loading'
          ? null
          : currentUser.value
            ? (`user:${currentUser.value.id}` as const)
            : 'anonymous',
      identityGeneration: generation,
      error: currentError.value ?? null,
    }),
    waitForInitialSettlement() {
      return waitForSettlement()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  const status = computed(() =>
    preset.value === 'loading'
      ? ('loading' as const)
      : currentError.value
        ? ('error' as const)
        : currentUser.value
          ? ('authenticated' as const)
          : ('anonymous' as const),
  )
  const auth = {
    status,
    pending: computed(() => preset.value === 'loading'),
    user: readonly(currentUser),
    error: computed(() => currentError.value),
    client: Object.freeze({
      signIn: Object.freeze({
        async email() {
          change('authenticated', DEFAULT_USER)
          return { data: {}, error: null }
        },
      }),
      signUp: Object.freeze({
        async email() {
          change('authenticated', DEFAULT_USER)
          return { data: {}, error: null }
        },
      }),
      async signOut() {
        change('anonymous', null)
        return { data: {}, error: null }
      },
    }),
    async ready(options?: { timeoutMs?: number }) {
      await waitForSettlement(options?.timeoutMs)
      return status.value
    },
    signIn: (user: ConvexUser = DEFAULT_USER) => change('authenticated', user),
    signOut: () => change('anonymous', null),
    setLoading: () => change('loading', null),
    fail: (error: unknown) =>
      change(
        'error',
        null,
        error instanceof ConvexCallError
          ? error
          : new ConvexCallError({
              kind: 'authentication',
              message: error instanceof Error ? error.message : String(error),
            }),
      ),
  } satisfies BetterConvexTestAuth

  return { auth: Object.freeze(auth), observer }
}
