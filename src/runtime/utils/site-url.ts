import { normalizeAuthOrigin, type AuthOriginName } from '../shared/auth-origin'

function normalizeConvexOrigin(
  value: string,
  label: 'url' | 'siteUrl',
  originName: AuthOriginName,
): string {
  try {
    return normalizeAuthOrigin(value, originName)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid origin'
    throw new TypeError(`${label} is unsafe: ${detail}`, { cause: error })
  }
}

/** Return one credential-safe Convex deployment origin or throw before client construction. */
export function normalizeConvexDeploymentUrl(url: string): string {
  return normalizeConvexOrigin(url, 'url', 'convex.url')
}

/** Return one credential-safe Convex site origin or throw before network access. */
export function normalizeConvexSiteUrl(siteUrl: string): string {
  return normalizeConvexOrigin(siteUrl, 'siteUrl', 'convex.siteUrl')
}
