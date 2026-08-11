import { components } from './_generated/api'
import { internalQuery } from './_generated/server'

/** Exact, non-secret persisted-token evidence for the local OAuth security gate. */
export const countCredentialRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [accessTokens, refreshTokens, idTokens] = await Promise.all([
      ctx.runQuery(components.betterAuth.adapter.count, {
        model: 'oauthAccessToken',
      }),
      ctx.runQuery(components.betterAuth.adapter.count, {
        model: 'oauthRefreshToken',
      }),
      ctx.runQuery(components.betterAuth.adapter.count, {
        model: 'account',
        where: [{ field: 'idToken', operator: 'ne', value: null }],
      }),
    ])
    if (
      [accessTokens, idTokens, refreshTokens].some(
        (count) => !Number.isSafeInteger(count) || count < 0 || count > 100,
      )
    ) {
      throw new Error('MCP_OAUTH_EVIDENCE_BOUND_EXCEEDED')
    }
    return { accessTokens, idTokens, refreshTokens }
  },
})
