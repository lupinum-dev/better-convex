import { describe, expect, it } from 'vitest'

import type { PinnedOAuthProviderProfile } from '../../src/runtime/convex-auth/oauth-security'
import { CONVEX_SITE_URL, createRealAuth, useAuthEnvironment } from '../helpers/real-auth'

const profile: PinnedOAuthProviderProfile = {
  accessTokenExpiresIn: 600,
  allowDynamicClientRegistration: false,
  allowPublicClientPrelogin: true,
  allowUnauthenticatedClientRegistration: false,
  clientPrivileges: async () => true,
  codeExpiresIn: 120,
  consentPage: '/oauth/consent',
  customAccessTokenClaims: () => ({ token_use: 'oauth-access' }),
  dpop: { signingAlgorithms: [] },
  enforcePerClientResources: true,
  grantTypes: ['authorization_code'],
  loginPage: '/login',
  rateLimit: {
    authorize: { max: 30, window: 60 },
    revoke: { max: 30, window: 60 },
    token: { max: 20, window: 60 },
  },
  resourcePrivileges: async () => true,
  scopes: ['notes.read'],
  storeClientSecret: 'hashed',
  storeTokens: 'hashed',
}
const resource = `${CONVEX_SITE_URL}/mcp`
const redirectUri = 'http://localhost:3000/callback'

async function setup() {
  const s = createRealAuth({ oauthProvider: profile })
  const createClient = async (name: string) => {
    const { clientId } = await s.test.action((ctx) =>
      s.auth.oauthOperator.createPublicClient(ctx, {
        name,
        profile: 'route-guards',
        redirectUris: [redirectUri],
        resource: { identifier: resource, name: 'Notes MCP', ownership: 'application' },
        scopes: ['notes.read'],
      }),
    )
    return clientId
  }
  return { ...s, createClient }
}

const authorizeQuery = (clientId: string, forResource = resource) =>
  new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'notes.read',
    state: 'state-1',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    resource: forResource,
  })

describe('OAuth route guards through real Better Auth', () => {
  useAuthEnvironment()

  // Catches: a router that also serves `/oauth2/token/` letting a request reach the provider
  // without the token, revoke and authorize checks. Each request is one the check refuses.
  it.each([
    ['POST', '/oauth2/token'],
    ['POST', '/oauth2/revoke'],
    ['GET', '/oauth2/authorize'],
  ] as const)('refuses %s %s the same way with a trailing slash', async (method, path) => {
    const s = await setup()
    const clientId = await s.createClient('Notes')
    const browser = s.client('198.51.100.20')
    const send = (route: string) =>
      method === 'GET'
        ? browser.get(`${route}?${authorizeQuery(clientId, 'https://other.example/mcp')}`)
        : browser.post(route, { grant_type: 'authorization_code', client_id: clientId })
    const canonical = await send(path)
    // A refused authorization goes back to the client's redirect URI with an error.
    expect(canonical.location || String(canonical.status)).toMatch(
      canonical.location ? /error=/u : /^4(?!04)/u,
    )
    const slashed = await send(`${path}/`)
    const answer = ({ status, body, location }: typeof canonical) => ({ status, body, location })
    expect(answer(slashed)).toEqual(answer(canonical))
  })

  // Catches: one signed authorization query reading the display fields of every other client.
  it('shows a client before sign-in only for its own signed authorization query', async () => {
    const s = await setup()
    const notes = await s.createClient('Notes')
    const other = await s.createClient('Other app')
    const browser = s.client('198.51.100.21')
    const authorize = await browser.get(`/oauth2/authorize?${authorizeQuery(notes)}`)
    const oauthQuery = new URL(authorize.location, 'https://app.example.test').search.slice(1)
    expect(new URLSearchParams(oauthQuery).get('sig')).toBeTruthy()

    const own = await browser.post('/oauth2/public-client-prelogin', {
      client_id: notes,
      oauth_query: oauthQuery,
    })
    expect(own).toMatchObject({ status: 200, body: { client_id: notes, client_name: 'Notes' } })
    const foreign = await browser.post('/oauth2/public-client-prelogin', {
      client_id: other,
      oauth_query: oauthQuery,
    })
    expect(foreign.status).toBe(400)
    expect(JSON.stringify(foreign.body)).not.toContain('Other app')
  })
})
