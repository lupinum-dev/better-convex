export const INTERACTION_ORIGIN = 'https://notes.example.invalid'
export const INTERACTION_PATH_PREFIX = '/interactions/'
export const INTERACTION_SESSION_COOKIE = 'better_convex_interaction_session'
export const INTERACTION_LOCATOR_PATTERN = /^[\w-]{32,128}$/u

export function isInteractionLocator(value: string): boolean {
  return INTERACTION_LOCATOR_PATTERN.test(value)
}

export function interactionPath(locator: string): string {
  if (!isInteractionLocator(locator)) throw new Error('INTERACTION_LOCATOR_INVALID')
  return `${INTERACTION_PATH_PREFIX}${locator}`
}

export function interactionUrl(locator: string): string {
  return new URL(interactionPath(locator), INTERACTION_ORIGIN).href
}

export function interactionLocatorFromPath(pathname: string): string | null {
  if (!pathname.startsWith(INTERACTION_PATH_PREFIX)) return null
  const locator = pathname.slice(INTERACTION_PATH_PREFIX.length)
  return isInteractionLocator(locator) ? locator : null
}

export const INTERACTION_LAB_SESSIONS = Object.freeze({
  alice: 'interaction-session-alice-7f38a5d9',
  bob: 'interaction-session-bob-18c90e42',
  sameSubjectOtherIssuer: 'interaction-session-other-issuer-615dc477',
})
