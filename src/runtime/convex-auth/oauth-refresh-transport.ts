import { getCurrentAuthContext } from '@better-auth/core/context'
import { APIError } from 'better-auth/api'
import { decodeBasicCredentials } from 'better-auth/oauth2'

const rotatedParents = new WeakMap<object, string>()
const presentedGrants = new WeakMap<object, string>()

/** Evidence is request-local; the component checks the parent again in its write transaction. */
export async function rememberOAuthRefreshRotation(row: unknown): Promise<void> {
  if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string') return
  const context = await getCurrentAuthContext()
  rotatedParents.set(context, row.id)
}

export async function takeOAuthRefreshParent(): Promise<string | undefined> {
  const context = await getCurrentAuthContext()
  const parent = rotatedParents.get(context)
  rotatedParents.delete(context)
  if (context.path === '/oauth2/token' && context.body?.grant_type === 'refresh_token' && !parent) {
    throw new Error('AUTH_OAUTH_REFRESH_ROTATION_REQUIRED')
  }
  return parent
}

export function oauthRefreshBusy(): never {
  throw new APIError(
    'SERVICE_UNAVAILABLE',
    {
      error: 'temporarily_unavailable',
      error_description: 'Refresh is in progress; retry the same request.',
    },
    { 'Retry-After': '1' },
  )
}

export async function assertOAuthRefreshReady(row: unknown): Promise<void> {
  if (!row || typeof row !== 'object') return
  const context = await getCurrentAuthContext()
  if (context.path !== '/oauth2/token' || context.body?.grant_type !== 'refresh_token') return
  if (
    'rotatedAt' in row &&
    row.rotatedAt != null &&
    'rotationReplayExpiresAt' in row &&
    typeof row.rotationReplayExpiresAt === 'number' &&
    row.rotationReplayExpiresAt >= Date.now() &&
    !('rotationReplayResponse' in row && row.rotationReplayResponse)
  )
    oauthRefreshBusy()
}

async function oauthRequestClientId(): Promise<string | undefined> {
  const context = await getCurrentAuthContext()
  if (typeof context.body?.client_id === 'string') return context.body.client_id
  const authorization =
    context.headers?.get('authorization') ?? context.request?.headers.get('authorization')
  if (authorization) return decodeBasicCredentials(authorization).clientId
}

export async function matchesOAuthRefreshClient(row: unknown): Promise<boolean> {
  const context = await getCurrentAuthContext()
  if (context.path !== '/oauth2/token' && context.path !== '/oauth2/revoke') return true
  if (!row || typeof row !== 'object' || !('clientId' in row)) return false
  const matches = row.clientId === (await oauthRequestClientId())
  if (matches && 'bcnConsentId' in row && typeof row.bcnConsentId === 'string')
    presentedGrants.set(context, row.bcnConsentId)
  return matches
}

/** Bind renewable JWTs to the immutable provider consent row, not just its replaceable scope set. */
export async function oauthRenewalGrantClaim(info: unknown): Promise<{ bcn_grant_id: string }> {
  if (
    !info ||
    typeof info !== 'object' ||
    !('user' in info) ||
    !info.user ||
    typeof info.user !== 'object' ||
    !('id' in info.user) ||
    typeof info.user.id !== 'string'
  )
    throw new Error('AUTH_OAUTH_GRANT_INVALID')
  const context = await getCurrentAuthContext()
  const clientId = await oauthRequestClientId()
  if (!clientId) throw new Error('AUTH_OAUTH_GRANT_INVALID')
  const consent = await context.context.adapter.findOne<{ id: string }>({
    model: 'oauthConsent',
    where: [
      { field: 'clientId', value: clientId },
      { field: 'userId', value: info.user.id },
    ],
  })
  if (!consent?.id) throw new Error('AUTH_OAUTH_GRANT_INVALID')
  return { bcn_grant_id: consent.id }
}

export async function presentedOAuthRefreshGrant(): Promise<string | undefined> {
  return presentedGrants.get(await getCurrentAuthContext())
}
