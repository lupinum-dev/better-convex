import type { GenericDataModel } from 'convex/server'

import type { AuthCtx } from './context'
import type { AuthAdapterComponentApi } from './types'

/** Provider-owned authority needed to revalidate a verified OAuth access token. */
export interface OAuthLiveAccess {
  readonly clientId: string
  readonly issuer: string
  readonly resource: string
  readonly scopes: readonly string[]
  readonly sessionId: string
  readonly subject: string
}

type AuthRecord = Record<string, unknown>

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

function validAccess(value: OAuthLiveAccess): boolean {
  if (
    !value ||
    !nonEmptyString(value.clientId) ||
    !nonEmptyString(value.issuer) ||
    !nonEmptyString(value.resource) ||
    !nonEmptyString(value.sessionId) ||
    !nonEmptyString(value.subject) ||
    !Array.isArray(value.scopes) ||
    value.scopes.length === 0 ||
    !value.scopes.every(nonEmptyString)
  ) {
    return false
  }
  return new Set(value.scopes).size === value.scopes.length
}

async function findOne<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  component: AuthAdapterComponentApi,
  model: string,
  where: readonly { field: string; value: string }[],
  select: readonly string[],
): Promise<AuthRecord | null> {
  return (await ctx.runQuery(component.adapter.findOne, {
    model,
    select: [...select],
    where: [...where],
  })) as AuthRecord | null
}

/**
 * Rechecks provider-owned authority from indexed Better Auth records. A disabled resource remains
 * valid for an already-issued token, matching the pinned provider; deleting it revokes access.
 */
export async function validateOAuthAccess<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  component: AuthAdapterComponentApi,
  access: OAuthLiveAccess,
): Promise<boolean> {
  if (!validAccess(access)) return false

  try {
    const [session, user, client, resource, link, consent] = await Promise.all([
      findOne(
        ctx,
        component,
        'session',
        [{ field: 'id', value: access.sessionId }],
        ['expiresAt', 'id', 'userId'],
      ),
      findOne(ctx, component, 'user', [{ field: 'id', value: access.subject }], ['id']),
      findOne(
        ctx,
        component,
        'oauthClient',
        [{ field: 'clientId', value: access.clientId }],
        ['clientId', 'disabled', 'scopes'],
      ),
      findOne(
        ctx,
        component,
        'oauthResource',
        [{ field: 'identifier', value: access.resource }],
        ['allowedScopes', 'identifier'],
      ),
      findOne(
        ctx,
        component,
        'oauthClientResource',
        [
          { field: 'clientId', value: access.clientId },
          { field: 'resourceId', value: access.resource },
        ],
        ['clientId', 'resourceId'],
      ),
      findOne(
        ctx,
        component,
        'oauthConsent',
        [
          { field: 'clientId', value: access.clientId },
          { field: 'userId', value: access.subject },
        ],
        ['clientId', 'resources', 'scopes', 'userId'],
      ),
    ])

    const clientScopes = stringArray(client?.scopes)
    const resourceScopes =
      resource?.allowedScopes === null ? null : stringArray(resource?.allowedScopes)
    const consentResources = stringArray(consent?.resources)
    const consentScopes = stringArray(consent?.scopes)

    return Boolean(
      session &&
      session.id === access.sessionId &&
      session.userId === access.subject &&
      typeof session.expiresAt === 'number' &&
      Number.isFinite(session.expiresAt) &&
      session.expiresAt > Date.now() &&
      user?.id === access.subject &&
      client &&
      client.clientId === access.clientId &&
      client.disabled !== true &&
      clientScopes &&
      containsEvery(clientScopes, access.scopes) &&
      resource &&
      resource.identifier === access.resource &&
      resourceScopes !== undefined &&
      (resourceScopes === null || containsEvery(resourceScopes, access.scopes)) &&
      link &&
      link.clientId === access.clientId &&
      link.resourceId === access.resource &&
      consent &&
      consent.clientId === access.clientId &&
      consent.userId === access.subject &&
      consentResources?.includes(access.resource) &&
      consentScopes &&
      containsEvery(consentScopes, access.scopes),
    )
  } catch {
    return false
  }
}
