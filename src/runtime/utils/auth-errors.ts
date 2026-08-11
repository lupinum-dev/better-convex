const PREFIX = 'NuxtConvexError'

function prefix(message: string): string {
  return `${PREFIX}: ${message}`
}

export function buildMissingSiteUrlMessage(): string {
  return prefix('Auth proxy requires a configured Convex HTTP Actions host (`convex.siteUrl`).')
}

export function buildMissingPublicOriginMessage(): string {
  return prefix('Auth proxy requires one canonical public Nuxt origin. Set `convex.auth.origin`.')
}

export function buildBlockedOriginMessage(): string {
  return prefix('Cross-origin auth request blocked. Use the same-origin Nuxt auth proxy.')
}

export function buildAuthProxyUnreachableMessage(): string {
  return prefix(
    'Auth proxy could not reach the configured Convex auth server. Check `convex.siteUrl` and the deployed Convex HTTP routes.',
  )
}

export function buildAuthProxyUpstreamStatusMessage(status: number): string {
  const hint =
    status === 404
      ? 'This usually means Better Auth routes are not registered in `convex/http.ts` or `convex.siteUrl` points to the wrong host.'
      : 'Check your Convex deployment health and Better Auth setup.'
  return prefix(`Auth proxy upstream returned HTTP ${status}. ${hint}`)
}
