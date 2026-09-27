import type { GenericDataModel } from 'convex/server'

import type { AuthCtx, WritableAuthCtx } from './context'
import type { AuthAdapterComponentApi } from './types'

/** One OAuth client a user has granted access to. `grantedAt` is epoch milliseconds. */
export interface BetterConvexOAuthConnection {
  readonly clientId: string
  readonly clientName: string | null
  readonly scopes: readonly string[]
  readonly grantedAt: number | null
}

/**
 * Plain functions over a user's OAuth grants. Both take the user id as an
 * argument: the application must pass the authenticated caller's id (for
 * example from `requireUser`) and must never accept it from client input.
 */
export interface BetterConvexOAuthConnections<DataModel extends GenericDataModel> {
  /** Up to 100 current grants of `userId`, newest first. */
  readonly list: (
    ctx: AuthCtx<DataModel>,
    input: { readonly userId: string },
  ) => Promise<BetterConvexOAuthConnection[]>
  /**
   * Revoke the grant of `userId` to `clientId`: delete the consent and the
   * refresh tokens of that user and client only. The next MCP request with an
   * already-issued access token fails the live check.
   */
  readonly revoke: (
    ctx: WritableAuthCtx<DataModel>,
    input: { readonly userId: string; readonly clientId: string },
  ) => Promise<{ readonly revoked: boolean }>
}

const MAX_CONNECTIONS = 100
const REFRESH_TOKEN_BATCH = 128
const MAX_REFRESH_TOKEN_BATCHES = 8

function requireId(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error(code)
  }
  return value
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function createOAuthConnections<DataModel extends GenericDataModel>(
  component: AuthAdapterComponentApi,
): BetterConvexOAuthConnections<DataModel> {
  return Object.freeze({
    async list(ctx: AuthCtx<DataModel>, input: { readonly userId: string }) {
      const userId = requireId(input?.userId, 'AUTH_OAUTH_CONNECTION_USER_INVALID')
      const consents = (await ctx.runQuery(component.adapter.findMany, {
        model: 'oauthConsent',
        where: [{ field: 'userId', value: userId }],
        select: ['clientId', 'createdAt', 'scopes', 'userId'],
        paginationOpts: { cursor: null, numItems: MAX_CONNECTIONS },
      })) as { page: Record<string, unknown>[] }
      const rows = consents.page.filter(
        (row) => row.userId === userId && typeof row.clientId === 'string' && row.clientId,
      )
      const clientIds = [...new Set(rows.map((row) => row.clientId as string))]
      const clients = new Map<string, Record<string, unknown>>()
      await Promise.all(
        clientIds.map(async (clientId) => {
          const client = (await ctx.runQuery(component.adapter.findOne, {
            model: 'oauthClient',
            where: [{ field: 'clientId', value: clientId }],
            select: ['clientId', 'name'],
          })) as Record<string, unknown> | null
          if (client?.clientId === clientId) clients.set(clientId, client)
        }),
      )
      return rows
        .filter((row) => clients.has(row.clientId as string))
        .map((row) => {
          const client = clients.get(row.clientId as string)!
          return Object.freeze({
            clientId: row.clientId as string,
            clientName: typeof client.name === 'string' ? client.name : null,
            scopes: Object.freeze(strings(row.scopes)),
            grantedAt: typeof row.createdAt === 'number' ? row.createdAt : null,
          })
        })
        .sort((left, right) => (right.grantedAt ?? 0) - (left.grantedAt ?? 0))
    },

    async revoke(
      ctx: WritableAuthCtx<DataModel>,
      input: { readonly userId: string; readonly clientId: string },
    ) {
      const userId = requireId(input?.userId, 'AUTH_OAUTH_CONNECTION_USER_INVALID')
      const clientId = requireId(input?.clientId, 'AUTH_OAUTH_CLIENT_ID_INVALID')
      const where = [
        { field: 'clientId', value: clientId },
        { field: 'userId', value: userId },
      ]
      // Consent first: its deletion alone fails every later live check and
      // every refresh for this grant, even if a later step is interrupted.
      const consents = await ctx.runMutation(component.adapter.deleteMany, {
        model: 'oauthConsent',
        where,
      })
      let refreshTokens = 0
      for (let batch = 0; batch < MAX_REFRESH_TOKEN_BATCHES; batch++) {
        const deleted = await ctx.runMutation(component.adapter.deleteMany, {
          model: 'oauthRefreshToken',
          where,
        })
        refreshTokens += deleted
        if (deleted < REFRESH_TOKEN_BATCH) break
      }
      return Object.freeze({ revoked: consents + refreshTokens > 0 })
    },
  })
}
