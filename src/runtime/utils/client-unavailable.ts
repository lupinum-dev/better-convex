import type { ConvexClientHandle } from '@lupinum/better-convex-vue'
import { getFunctionName, type FunctionReference } from 'convex/server'

import { ConvexCallError } from '../errors'

const CLIENT_UNAVAILABLE = 'CLIENT_UNAVAILABLE'

function clientUnavailableError(
  message: string,
  functionName?: string,
  outcome?: 'not-sent',
): ConvexCallError {
  return new ConvexCallError({
    kind: 'unknown',
    code: CLIENT_UNAVAILABLE,
    message: `[better-convex-nuxt] ${message}`,
    functionName,
    outcome,
  })
}

function readFunctionName(reference: unknown): string | undefined {
  try {
    return getFunctionName(reference as FunctionReference<'query' | 'mutation' | 'action'>)
  } catch {
    return undefined
  }
}

function unavailableCall(method: 'query' | 'mutation' | 'action') {
  return (reference: unknown) =>
    Promise.reject(
      clientUnavailableError(
        `useConvex().${method}() needs the browser Convex client, which does not exist during server rendering or without a configured Convex URL. Use useConvexQuery for server-rendered data and serverConvex(event) in Nitro handlers.`,
        readFunctionName(reference),
        // No Convex client exists, so nothing was sent.
        'not-sent',
      ),
    )
}

/**
 * The `useConvex()` handle used where no browser runtime exists (SSR, or a
 * build without a Convex URL). Reading it is safe; `query`, `mutation`, and
 * `action` reject and `onUpdate` throws with code `CLIENT_UNAVAILABLE`.
 */
export const UNAVAILABLE_CONVEX_HANDLE: ConvexClientHandle = Object.freeze({
  query: unavailableCall('query') as ConvexClientHandle['query'],
  mutation: unavailableCall('mutation') as ConvexClientHandle['mutation'],
  action: unavailableCall('action') as ConvexClientHandle['action'],
  onUpdate: ((reference: unknown) => {
    throw clientUnavailableError(
      'useConvex().onUpdate() needs the browser Convex client, which does not exist during server rendering or without a configured Convex URL. Subscribe from onMounted() or use useConvexQuery.',
      readFunctionName(reference),
      'not-sent',
    )
  }) as ConvexClientHandle['onUpdate'],
})

const INERT_LABEL = '[better-convex-nuxt: auth client unavailable]'

/**
 * Keys that introspection (Vue reactivity, Promise resolution, serializers,
 * test matchers, Node inspection) reads from arbitrary values. The inert client
 * must answer them as an ordinary non-reactive, non-thenable object instead of
 * returning another callable proxy.
 */
const ABSENT_KEYS = new Set([
  'then',
  'catch',
  'finally',
  'toJSON',
  'constructor',
  'asymmetricMatch',
  '$$typeof',
  'nodeType',
  'inspect',
])

function createInertAuthClientNode(path: readonly string[]): unknown {
  const describe = () => INERT_LABEL
  // An arrow function is callable but has no non-configurable own properties,
  // so the `has`/`get` traps below never violate a Proxy invariant.
  const target = () => {}
  return new Proxy(target, {
    get(_target, key) {
      if (key === Symbol.toPrimitive || key === 'toString' || key === 'valueOf') return describe
      if (key === Symbol.toStringTag) return 'ConvexAuthClientUnavailable'
      if (typeof key === 'symbol') return undefined
      // Vue's `markRaw` flag keeps the inert client out of reactive proxies.
      if (key === '__v_skip') return true
      if (key.startsWith('__v_') || ABSENT_KEYS.has(key)) return undefined
      return createInertAuthClientNode([...path, key])
    },
    apply() {
      const member = path.length > 0 ? `.${path.join('.')}` : ''
      throw clientUnavailableError(
        `useConvexAuth().client${member}() needs the browser Better Auth client, which exists only after the Convex runtime starts in the browser. Call it from an event handler or onMounted(), and read the SSR identity from useConvexAuth().user.`,
      )
    },
    has() {
      return false
    },
    set() {
      return false
    },
    defineProperty(inertTarget, key, descriptor) {
      // Vue's `markRaw()` defines this flag; every other write is refused.
      return key === '__v_skip' && Reflect.defineProperty(inertTarget, key, descriptor)
    },
    deleteProperty() {
      return false
    },
  })
}

/**
 * The `useConvexAuth().client` value used where no browser auth runtime exists.
 * Destructuring and property reads never throw; calling any member throws a
 * `ConvexCallError` with code `CLIENT_UNAVAILABLE`.
 */
export const UNAVAILABLE_AUTH_CLIENT: object = createInertAuthClientNode([]) as object
