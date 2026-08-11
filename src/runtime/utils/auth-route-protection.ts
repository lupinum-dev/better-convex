import type { RouteLocationRaw } from 'vue-router'

export type ConvexAuthPageMeta = boolean | { redirectTo?: RouteLocationRaw }

export interface RouteProtectionDecisionInput {
  meta: ConvexAuthPageMeta | undefined
  defaultRedirectTo: string
  preserveReturnTo: boolean
  currentPath: string
  currentFullPath?: string
}

export interface RouteProtectionDecision {
  redirectTo: RouteLocationRaw
}

const LOCAL_URL_BASE = 'https://better-convex-nuxt.invalid'

function hasUnsafePathCharacter(value: string): boolean {
  for (const character of value) {
    const codeUnit = character.charCodeAt(0)
    if (character === '\\' || codeUnit <= 31 || codeUnit === 127) return true
  }
  return false
}

export function normalizeLocalRedirectPath(value: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//') || hasUnsafePathCharacter(value)) {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }
  if (decoded.startsWith('//') || hasUnsafePathCharacter(decoded)) {
    return null
  }

  const parsed = new URL(value, LOCAL_URL_BASE)
  if (parsed.origin !== LOCAL_URL_BASE || parsed.pathname.startsWith('//')) {
    return null
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function resolveRouteProtectionDecision(
  input: RouteProtectionDecisionInput,
): RouteProtectionDecision | null {
  const { meta, defaultRedirectTo, preserveReturnTo, currentPath } = input
  const currentFullPath = input.currentFullPath ?? currentPath

  if (meta === undefined || meta === false) return null

  const redirectBase =
    typeof meta === 'object' && meta !== null && meta.redirectTo
      ? meta.redirectTo
      : defaultRedirectTo

  if (!redirectBase) return null
  if (typeof redirectBase !== 'string') {
    if ('path' in redirectBase && typeof redirectBase.path === 'string') {
      const path = normalizeLocalRedirectPath(redirectBase.path)
      if (!path) return null
      return { redirectTo: { ...redirectBase, path } }
    }
    return { redirectTo: redirectBase }
  }
  const redirectPath = normalizeLocalRedirectPath(redirectBase)
  if (!redirectPath) return null
  const redirectPathOnly = redirectPath.split(/[?#]/)[0] || redirectPath
  if (currentPath === redirectPathOnly) return null

  if (!preserveReturnTo) {
    return { redirectTo: redirectPath }
  }

  const returnTo =
    normalizeLocalRedirectPath(currentFullPath) ?? normalizeLocalRedirectPath(currentPath) ?? '/'
  const hashIndex = redirectPath.indexOf('#')
  const redirectWithoutHash = hashIndex === -1 ? redirectPath : redirectPath.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : redirectPath.slice(hashIndex)
  const hasQuery = redirectWithoutHash.includes('?')
  const separator = hasQuery ? '&' : '?'
  return {
    redirectTo: `${redirectWithoutHash}${separator}redirect=${encodeURIComponent(returnTo)}${hash}`,
  }
}
