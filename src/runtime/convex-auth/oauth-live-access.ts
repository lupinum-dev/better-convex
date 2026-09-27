import type { GenericDataModel, GenericQueryCtx } from 'convex/server'
import { v } from 'convex/values'

import type { AuthCtx } from './context'
import { equalityRange } from './oauth-refresh'
import { readAuthSessionAdmission } from './session-generation'
import type { AuthAdapterComponentApi } from './types'

/** Arguments of the component's single live-grant query. */
export const oauthLiveAccessArgs = {
  clientId: v.string(),
  grantId: v.string(),
  resource: v.string(),
  scopes: v.array(v.string()),
  sessionId: v.string(),
  userId: v.string(),
}

type Row = Record<string, unknown>

export interface OAuthLiveGrant {
  /** The admitted live user row. */
  readonly user: Row
  /** The live consent id (the immutable provider grant identity). */
  readonly grantId: string
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(nonEmptyString) && new Set(value).size === value.length
    ? value
    : undefined
}

function containsEvery(values: readonly string[], required: readonly string[]): boolean {
  const available = new Set(values)
  return required.every((value) => available.has(value))
}

function validRequest(value: {
  clientId: unknown
  grantId: unknown
  resource: unknown
  scopes: unknown
  sessionId: unknown
  userId: unknown
}): boolean {
  const scopes = stringArray(value.scopes)
  return (
    nonEmptyString(value.clientId) &&
    nonEmptyString(value.resource) &&
    nonEmptyString(value.sessionId) &&
    nonEmptyString(value.userId) &&
    // Every token must name the consent it was issued under.
    nonEmptyString(value.grantId) &&
    scopes !== undefined &&
    scopes.length > 0
  )
}

/** Exactly one row, or `null` for none and for an ambiguous duplicate. */
async function single(rows: Promise<Row[]>): Promise<Row | null> {
  const found = await rows
  return found.length === 1 ? found[0]! : null
}

/**
 * Component-side live grant check: session admission (expiry and identity
 * generation), client, resource, client-resource link, and the exact consent
 * the token was issued under, all read through indexes in one query
 * transaction. Disabling or deleting the client or resource revokes
 * already-issued tokens immediately.
 */
export async function readOAuthLiveGrant(
  ctx: GenericQueryCtx<GenericDataModel>,
  args: {
    clientId: string
    grantId: string
    resource: string
    scopes: readonly string[]
    sessionId: string
    userId: string
  },
): Promise<OAuthLiveGrant | null> {
  if (!validRequest(args)) return null
  const { clientId, resource: identifier, userId } = args
  const admission = await readAuthSessionAdmission(ctx, {
    sessionId: args.sessionId,
    userId,
  })
  if (!admission) return null
  const db = ctx.db
  const [client, resource, link, consent] = await Promise.all([
    single(
      db
        .query('oauthClient')
        .withIndex('clientId', (q) => q.eq('clientId', clientId))
        .take(2),
    ),
    single(
      db
        .query('oauthResource')
        .withIndex('identifier', (q) => q.eq('identifier', identifier))
        .take(2),
    ),
    single(
      db
        .query('oauthClientResource')
        .withIndex(
          'clientId_resourceId',
          equalityRange(['clientId', clientId], ['resourceId', identifier]),
        )
        .take(2),
    ),
    single(
      db
        .query('oauthConsent')
        .withIndex('clientId_userId', equalityRange(['clientId', clientId], ['userId', userId]))
        .take(2),
    ),
  ])

  const clientScopes = stringArray(client?.scopes)
  const resourceScopes =
    resource?.allowedScopes === null ? null : stringArray(resource?.allowedScopes)
  const consentResources = stringArray(consent?.resources)
  const consentScopes = stringArray(consent?.scopes)
  const scopes = args.scopes

  if (
    !client ||
    client.clientId !== clientId ||
    client.disabled === true ||
    !clientScopes ||
    !containsEvery(clientScopes, scopes) ||
    !resource ||
    resource.identifier !== identifier ||
    resource.disabled === true ||
    resourceScopes === undefined ||
    (resourceScopes !== null && !containsEvery(resourceScopes, scopes)) ||
    !link ||
    link.clientId !== clientId ||
    link.resourceId !== identifier ||
    !consent ||
    !nonEmptyString(consent.id) ||
    consent.id !== args.grantId ||
    consent.clientId !== clientId ||
    consent.userId !== userId ||
    !consentResources?.includes(identifier) ||
    !consentScopes ||
    !containsEvery(consentScopes, scopes)
  ) {
    return null
  }
  return { user: admission.user, grantId: consent.id }
}

/**
 * Resolve the live grant behind a verified OAuth principal with exactly one
 * component query. Any failure, including a malformed principal, is `null`.
 */
export async function queryOAuthLiveGrant<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  component: AuthAdapterComponentApi,
  access: {
    readonly clientId: string
    readonly grantId: string
    readonly resource: string
    readonly scopes: readonly string[]
    readonly sessionId: string
    readonly userId: string
  },
): Promise<{ readonly user: Record<string, unknown>; readonly grantId: string } | null> {
  const args = {
    clientId: access?.clientId,
    grantId: access?.grantId,
    resource: access?.resource,
    scopes: Array.isArray(access?.scopes) ? [...access.scopes] : access?.scopes,
    sessionId: access?.sessionId,
    userId: access?.userId,
  }
  if (!validRequest(args)) return null
  try {
    return await ctx.runQuery(component.adapter.oauthLiveAccess, args as never)
  } catch {
    return null
  }
}
