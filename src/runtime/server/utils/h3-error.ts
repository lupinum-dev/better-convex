import { H3Error } from 'h3'

import {
  normalizeConvexError,
  type ConvexCallError,
  type SerializedConvexCallError,
} from '../../errors'

const TRANSPORT_STATUS = 502
const DEFAULT_SERVER_STATUS = 400
const UNKNOWN_STATUS = 500

function httpStatusFor(error: ConvexCallError): number {
  switch (error.kind) {
    case 'authentication':
      return error.status === 403 ? 403 : 401
    case 'transport':
      return TRANSPORT_STATUS
    case 'server':
      return error.status !== undefined &&
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status <= 499
        ? error.status
        : DEFAULT_SERVER_STATUS
    default:
      return UNKNOWN_STATUS
  }
}

/**
 * Map any thrown value to an H3 error for a Nitro handler response.
 *
 * The value is first normalized to a `ConvexCallError`. The HTTP status follows
 * its kind: `authentication` is 401 (403 when the error carries 403),
 * `transport` is 502, `server` keeps a 4xx `status` from the application and
 * is 400 otherwise, and `unknown` is 500. The response body's `data` is the
 * error's `toJSON()` without `functionName`, so the browser revives the same
 * `ConvexCallError` with `normalizeConvexError` but never learns which Convex
 * function the route called. Log `functionName` from the original error on the
 * server. No raw cause, stack source, or credential is attached.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   try {
 *     return await serverConvex(event).mutation(api.notes.create, await readBody(event))
 *   } catch (error) {
 *     throw toConvexH3Error(error)
 *   }
 * })
 * ```
 */
export function toConvexH3Error(error: unknown): H3Error<SerializedConvexCallError> {
  const normalized = normalizeConvexError(error)
  const h3Error = new H3Error<SerializedConvexCallError>(normalized.message)
  h3Error.statusCode = httpStatusFor(normalized)
  // Function paths expose application topology; keep them server-side.
  h3Error.data = { ...normalized.toJSON(), functionName: undefined }
  return h3Error
}
