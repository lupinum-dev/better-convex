import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

import { normalizeConvexError } from '../errors'
import { createBoundedConvexFetch } from './bounded-convex-fetch'
import type { ConvexServerConfig } from './transport-config'

/**
 * Execute one request-scoped SSR query through Convex's official HTTP client.
 * The client owns Convex value encoding, response decoding, and structured
 * application-error reconstruction. The custom fetch owns only request bounds:
 * the configured `convex.server` limits when given, otherwise the defaults.
 * A failure is normalized with `functionName` set to `functionPath`.
 *
 * @internal
 */
export async function executeQueryHttp<T>(
  convexUrl: string,
  functionPath: string,
  args: Record<string, unknown>,
  authToken?: string,
  signal?: AbortSignal,
  bounds?: ConvexServerConfig,
): Promise<T> {
  const client = new ConvexHttpClient(convexUrl, {
    fetch: createBoundedConvexFetch({
      signal,
      maxResponseBytes: bounds?.maxResponseBytes,
      queryTimeoutMs: bounds?.queryTimeoutMs,
    }),
    logger: false,
  })
  if (authToken) client.setAuth(authToken)

  try {
    return (await client.query(
      makeFunctionReference<'query', Record<string, unknown>, T>(functionPath),
      args,
    )) as T
  } catch (error) {
    throw normalizeConvexError(error, { functionName: functionPath })
  }
}
