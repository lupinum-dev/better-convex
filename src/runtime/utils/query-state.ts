export interface ConvexQueryPendingInput {
  isSkipped: boolean
  server: boolean
  asyncDataPending: boolean
  isAuthPending?: boolean
}

/** Pending state for the SSR render of a query. */
export function computeConvexQueryPending(input: ConvexQueryPendingInput): boolean {
  if (input.isSkipped) return false
  if (input.isAuthPending) return true
  // A browser-only query stays pending in the server render.
  if (!input.server) return true
  return input.asyncDataPending
}
