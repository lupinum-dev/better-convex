import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server'

import { readAuthSessionAdmission } from './workforce/admission'

function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'string') &&
    new Set(value).size === value.length
  )
}

/** Existing provider rows are the only authority. Renewal never outlives the original session. */
export async function admitOAuthRefresh(
  ctx: GenericQueryCtx<GenericDataModel>,
  row: Record<string, unknown>,
  workforce: boolean,
  creating = false,
): Promise<{ expiresAt: number; grantId: string } | null> {
  if (
    typeof row.sessionId !== 'string' ||
    typeof row.userId !== 'string' ||
    typeof row.clientId !== 'string' ||
    !strings(row.resources) ||
    row.resources.length !== 1 ||
    !strings(row.scopes) ||
    !row.scopes.includes('offline_access')
  )
    return null
  const admission = await readAuthSessionAdmission(
    ctx,
    { sessionId: row.sessionId, userId: row.userId },
    workforce,
  )
  if (!admission) return null
  const clientId = row.clientId
  const userId = row.userId
  const identifier = row.resources[0]!
  const [client, resource, link, consent] = await Promise.all([
    ctx.db
      .query('oauthClient')
      .withIndex('clientId', (q) => q.eq('clientId', clientId))
      .unique(),
    ctx.db
      .query('oauthResource')
      .withIndex('identifier', (q) => q.eq('identifier', identifier))
      .unique(),
    ctx.db
      .query('oauthClientResource')
      .withIndex('clientId', (q) => q.eq('clientId', clientId))
      .filter((q) => q.eq(q.field('resourceId'), identifier))
      .unique(),
    ctx.db
      .query('oauthConsent')
      .withIndex('clientId', (q) => q.eq('clientId', clientId))
      .filter((q) => q.eq(q.field('userId'), userId))
      .unique(),
  ])
  if (
    !client ||
    client.disabled === true ||
    !strings(client.scopes) ||
    !resource ||
    resource.disabled === true ||
    !link ||
    !consent ||
    !strings(consent.scopes) ||
    !strings(consent.resources) ||
    !consent.resources.includes(identifier)
  )
    return null
  if ((!creating || row.bcnConsentId != null) && row.bcnConsentId !== consent.id) return null
  if (typeof consent.id !== 'string') return null
  const clientScopes = client.scopes
  const consentScopes = consent.scopes
  const resourceScopes = resource.allowedScopes
  if (
    row.scopes.some(
      (scope) =>
        !clientScopes.includes(scope) ||
        !consentScopes.includes(scope) ||
        (resourceScopes != null && (!strings(resourceScopes) || !resourceScopes.includes(scope))),
    )
  )
    return null
  return { expiresAt: admission.session.expiresAt as number, grantId: consent.id }
}

export async function prepareOAuthRefreshCreate(
  ctx: GenericMutationCtx<GenericDataModel>,
  row: Record<string, unknown>,
  parentId: string | undefined,
  workforce: boolean,
): Promise<Record<string, unknown>> {
  const admission = await admitOAuthRefresh(ctx, row, workforce, true)
  if (!admission || typeof row.expiresAt !== 'number') throw new Error('AUTH_OAUTH_REFRESH_INVALID')
  let expiresAt = Math.min(row.expiresAt, admission.expiresAt)
  if (parentId) {
    const parent = await ctx.db
      .query('oauthRefreshToken')
      .withIndex('id', (q) => q.eq('id', parentId))
      .unique()
    if (
      !parent ||
      parent.rotatedAt == null ||
      parent.revoked == null ||
      parent.clientId !== row.clientId ||
      parent.userId !== row.userId ||
      parent.sessionId !== row.sessionId ||
      parent.bcnConsentId !== admission.grantId ||
      !strings(parent.scopes) ||
      !strings(parent.resources) ||
      !strings(row.scopes) ||
      !strings(row.resources)
    )
      throw new Error('AUTH_OAUTH_REFRESH_INVALID')
    if (typeof parent.expiresAt !== 'number' || parent.expiresAt <= Date.now())
      throw new Error('AUTH_OAUTH_REFRESH_INVALID')
    expiresAt = Math.min(expiresAt, parent.expiresAt)
    const scopes = parent.scopes
    const resources = parent.resources
    if (
      row.scopes.some((scope) => !scopes.includes(scope)) ||
      row.resources.some((resource) => !resources.includes(resource))
    )
      throw new Error('AUTH_OAUTH_REFRESH_INVALID')
  }
  return { ...row, expiresAt, bcnConsentId: admission.grantId }
}

/** A provider family-reuse/revoke decision also revokes consent, denying outstanding JWTs. */
export async function revokeOAuthRefreshConsent(
  ctx: GenericMutationCtx<GenericDataModel>,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  const seen = new Set<string>()
  for (const row of rows) {
    if (typeof row.clientId !== 'string' || typeof row.userId !== 'string') continue
    const clientId = row.clientId
    const userId = row.userId
    const key = JSON.stringify([clientId, userId, row.bcnConsentId])
    if (seen.has(key)) continue
    seen.add(key)
    const consent = await ctx.db
      .query('oauthConsent')
      .withIndex('clientId', (q) => q.eq('clientId', clientId))
      .filter((q) => q.eq(q.field('userId'), userId))
      .unique()
    if (consent && consent.id === row.bcnConsentId && typeof consent._id === 'string') {
      const id = ctx.db.normalizeId('oauthConsent', consent._id)
      if (id) await ctx.db.delete(id)
    }
  }
}
