import {
  isExactLoopbackHost,
  normalizeAuthOrigin,
  requireAuthOrigin as requireSharedAuthOrigin,
} from '../shared/auth-origin'

type AuthOriginName = 'CONVEX_SITE_URL' | 'SITE_URL'

export { isExactLoopbackHost, normalizeAuthOrigin }

export function requireAuthOrigin(
  name: AuthOriginName,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return requireSharedAuthOrigin(name, env)
}
