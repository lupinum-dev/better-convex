import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

import { normalizeConvexError } from '../errors'
import { createBoundedConvexFetch } from './bounded-convex-fetch'

/**
 * Execute one request-scoped SSR query through Convex's official HTTP client.
 * The client owns Convex value encoding, response decoding, and structured
 * application-error reconstruction. The custom fetch owns only request bounds.
 *
 * @internal
 */
export async function executeQueryHttp<T>(
  convexUrl: string,
  functionPath: string,
  args: Record<string, unknown>,
  authToken?: string,
  signal?: AbortSignal,
): Promise<T> {
  const client = new ConvexHttpClient(convexUrl, {
    fetch: createBoundedConvexFetch({ signal }),
    logger: false,
  })
  if (authToken) client.setAuth(authToken)

  try {
    return (await client.query(
      makeFunctionReference<'query', Record<string, unknown>, T>(functionPath),
      args,
    )) as T
  } catch (error) {
    throw normalizeConvexError(error)
  }
}
