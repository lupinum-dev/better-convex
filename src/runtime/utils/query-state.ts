export interface ConvexQueryPendingInput {
  isSkipped: boolean
  hasData: boolean
  hasSettled: boolean
  server: boolean
  resolveImmediately: boolean
  isServer: boolean
  isClient: boolean
  asyncDataPending: boolean
  isAuthPending?: boolean
}

export function computeConvexQueryPending(input: ConvexQueryPendingInput): boolean {
  if (input.isSkipped) return false
  if (input.isAuthPending) return true

  if (!input.server) {
    if (input.isServer) return true
    if (input.isClient && !input.hasData && !input.hasSettled) return true
  }

  if (input.resolveImmediately && input.isClient && !input.hasData && !input.hasSettled) {
    return true
  }

  return input.asyncDataPending
}
