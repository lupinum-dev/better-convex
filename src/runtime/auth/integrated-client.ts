import type { IntegratedAuthClient } from '../auth-client'

export interface SessionCheckpoint {
  /** Provider session revision observed when the call started. */
  readonly revision: number
  /** Count of Better Auth `$sessionSignal` notifications when the call started. */
  readonly sessionSignals: number
  /** Count of potentially session-changing Better Auth requests when the call started. */
  readonly sessionRequests: number
}

export interface CanonicalSessionReconciler {
  checkpoint(): SessionCheckpoint
  /**
   * Finish a synchronous call. This deliberately may throw when that call
   * changed the provider session: such a plugin operation cannot be reconciled
   * without changing its synchronous contract.
   */
  cancel(checkpoint: SessionCheckpoint): void
  /**
   * Finish a Promise call. Reconciles when the call (or a concurrent one) sent
   * a Better Auth request outside the known read-only routes, Better Auth
   * signalled a session change, or the provider session revision moved since
   * the checkpoint; a read-only call resolves without minting a token.
   */
  settle(checkpoint: SessionCheckpoint): Promise<void>
  /** Re-read the provider session, then await matching Convex settlement (possibly anonymous). */
  reconcile(checkpoint: SessionCheckpoint): Promise<void>
}

const HIDDEN_ROOT_KEYS = new Set<PropertyKey>([
  '$fetch',
  '$store',
  'hydrateSession',
  // Installed only for the module-owned token exchange. It is intentionally
  // absent from the inferred consumer type and must also be absent at runtime.
  'convex',
])

const NON_THENABLE_ROOT_KEYS = new Set<PropertyKey>(['then', 'catch', 'finally'])

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (!isObjectLike(value)) return false
  return typeof Reflect.get(value, 'then') === 'function'
}

/**
 * Integrates Better Auth without inventing a second action list.
 *
 * The apply trap is intentionally synchronous. Better Auth 1.7 exposes both
 * synchronous APIs (`useSession()` and plugin permission checks) and
 * Promise-returning actions through recursive callable proxies. Synchronous
 * values pass through unchanged; only actual PromiseLike results cross the
 * canonical session reconciliation barrier, and only when a request outside
 * the known read-only routes, Better Auth's own session signal, or the
 * provider session revision reports a possible change.
 */
export function createIntegratedAuthClient<Client extends object>(
  client: Client,
  reconciler: CanonicalSessionReconciler,
): IntegratedAuthClient<Client> {
  const wrappedByRaw = new WeakMap<object, object>()
  const rawByWrapped = new WeakMap<object, object>()
  const propertyCache = new WeakMap<object, Map<PropertyKey, unknown>>()

  const unwrap = (value: unknown): unknown =>
    isObjectLike(value) ? (rawByWrapped.get(value) ?? value) : value

  const wrap = <Value extends object>(raw: Value, depth: number): Value => {
    const existing = wrappedByRaw.get(raw)
    if (existing) return existing as Value

    // A receiver-aware plugin may return `this`, while native `bind()` creates
    // a previously unseen callable around the raw provider action. Preserve
    // ordinary object results (notably Vue refs), but never let a returned
    // function become an unintegrated action escape hatch.
    const exposeResult = <Result>(value: Result): Result => {
      if (!isObjectLike(value)) return value
      const known = wrappedByRaw.get(value)
      if (known) return known as Result
      if (rawByWrapped.has(value)) return value
      return (typeof value === 'function' ? wrap(value, depth + 1) : value) as Result
    }

    // Proxy a sterile target rather than the provider object itself. Otherwise
    // reflection APIs can bypass `get` and recover hidden raw own properties.
    const target: object =
      typeof raw === 'function' ? (..._arguments: unknown[]) => undefined : Object.create(null)

    const readExposedProperty = (property: PropertyKey): unknown => {
      let cached = propertyCache.get(raw)
      if (!cached) {
        cached = new Map()
        propertyCache.set(raw, cached)
      }
      if (cached.has(property)) return cached.get(property)

      const value = Reflect.get(raw, property, raw)
      const exposed = isObjectLike(value) ? wrap(value, depth + 1) : value
      cached.set(property, exposed)
      return exposed
    }

    const isHidden = (property: PropertyKey): boolean =>
      depth === 0 && (HIDDEN_ROOT_KEYS.has(property) || NON_THENABLE_ROOT_KEYS.has(property))

    const proxy = new Proxy(target, {
      get(_target, property) {
        if (isHidden(property)) return undefined
        return readExposedProperty(property)
      },
      has(_target, property) {
        if (isHidden(property)) return false
        return Reflect.has(raw, property)
      },
      ownKeys(shadow) {
        const keys = new Set(Reflect.ownKeys(shadow))
        for (const property of Reflect.ownKeys(raw)) {
          if (!isHidden(property)) keys.add(property)
        }
        return [...keys]
      },
      getOwnPropertyDescriptor(shadow, property) {
        const shadowDescriptor = Reflect.getOwnPropertyDescriptor(shadow, property)
        if (shadowDescriptor && shadowDescriptor.configurable === false) return shadowDescriptor
        if (isHidden(property)) return undefined

        const descriptor = Reflect.getOwnPropertyDescriptor(raw, property)
        if (!descriptor) return shadowDescriptor
        return {
          configurable: true,
          enumerable: descriptor.enumerable,
          ...(descriptor.get || descriptor.set
            ? {
                get: descriptor.get ? () => readExposedProperty(property) : undefined,
                set: undefined,
              }
            : {
                value: readExposedProperty(property),
                writable: false,
              }),
        }
      },
      set() {
        return false
      },
      defineProperty() {
        return false
      },
      deleteProperty() {
        return false
      },
      setPrototypeOf() {
        return false
      },
      preventExtensions() {
        return false
      },
      apply(_target, thisArgument, argumentsList) {
        const checkpoint = reconciler.checkpoint()
        let result: unknown
        let promiseLike: boolean
        try {
          result = Reflect.apply(
            raw as unknown as (...args: unknown[]) => unknown,
            unwrap(thisArgument),
            argumentsList,
          )
          promiseLike = isPromiseLike(result)
        } catch (error) {
          // `cancel` detects a synchronous provider-session change and may
          // replace an unsafe/raw failure with the static fail-closed error.
          reconciler.cancel(checkpoint)
          throw error
        }

        if (!promiseLike) {
          reconciler.cancel(checkpoint)
          return exposeResult(result)
        }

        return Promise.resolve(result).then(
          async (value) => {
            await reconciler.settle(checkpoint)
            return exposeResult(value)
          },
          async (error) => {
            await reconciler.settle(checkpoint)
            throw error
          },
        )
      },
    })

    wrappedByRaw.set(raw, proxy)
    rawByWrapped.set(proxy, raw)
    return proxy as Value
  }

  return wrap(client, 0) as IntegratedAuthClient<Client>
}
