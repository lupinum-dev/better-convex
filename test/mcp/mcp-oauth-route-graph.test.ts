import { afterEach, describe, expect, it, vi } from 'vitest'

import http from '../../starters/mcp-oauth-agent/convex/http'

const deploymentOrigin = 'https://starter-deployment.example.test'
const applicationOrigin = 'https://starter-app.example.test'

type RouteMethod = Parameters<typeof http.lookup>[1]
type RegisteredHttpAction = {
  _handler: (ctx: unknown, request: Request) => Promise<Response>
}

async function dispatch(path: string, method: RouteMethod, init: RequestInit = {}) {
  const route = http.lookup(path, method)
  if (!route) throw new Error(`Missing ${method} ${path} route`)
  const handler = route[0] as RegisteredHttpAction
  return await handler._handler(
    {},
    new Request(`${deploymentOrigin}${path}`, {
      ...init,
      method,
    }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('delegated OAuth starter HTTP route graph', () => {
  it('follows resource_metadata from a real 401 through GET, HEAD, and OPTIONS', async () => {
    vi.stubEnv('SITE_URL', applicationOrigin)
    vi.stubEnv('CONVEX_SITE_URL', deploymentOrigin)

    const denied = await dispatch('/mcp', 'POST', {
      body: '{}',
      headers: {
        authorization: 'Bearer malformed-token',
        'content-type': 'application/json',
      },
    })
    expect(denied.status).toBe(401)

    const challenge = denied.headers.get('www-authenticate')
    const metadataMatch = /\bresource_metadata="([^"]+)"/u.exec(challenge ?? '')
    if (!metadataMatch) throw new Error('401 challenge omitted resource_metadata')
    expect(metadataMatch[1]).toBe(`${deploymentOrigin}/.well-known/oauth-protected-resource/mcp`)
    const metadataUrl = new URL(metadataMatch[1])

    const get = await dispatch(metadataUrl.pathname, 'GET')
    expect(get.status).toBe(200)
    expect(get.headers.get('access-control-allow-origin')).toBe('*')
    await expect(get.json()).resolves.toMatchObject({
      authorization_servers: [`${applicationOrigin}/api/auth`],
      resource: `${deploymentOrigin}/mcp`,
      scopes_supported: ['mcp:read', 'mcp:write'],
    })

    const head = await dispatch(metadataUrl.pathname, 'HEAD')
    expect(head.status).toBe(200)
    expect(head.headers.get('access-control-allow-origin')).toBe('*')
    await expect(head.text()).resolves.toBe('')

    const options = await dispatch(metadataUrl.pathname, 'OPTIONS', {
      headers: { 'access-control-request-headers': 'authorization, mcp-method' },
    })
    expect(options.status).toBe(204)
    expect(options.headers.get('access-control-allow-origin')).toBe('*')
    expect(options.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
    expect(options.headers.get('access-control-allow-headers')).toBe('authorization, mcp-method')
  })

  it('routes unsupported transport methods to the MCP handler without opening CORS transport', async () => {
    vi.stubEnv('SITE_URL', applicationOrigin)
    vi.stubEnv('CONVEX_SITE_URL', deploymentOrigin)

    await expect(dispatch('/mcp', 'GET')).resolves.toMatchObject({ status: 405 })
    await expect(dispatch('/mcp', 'DELETE')).resolves.toMatchObject({ status: 405 })
    expect(http.lookup('/mcp', 'HEAD')).not.toBeNull()
    expect(http.lookup('/mcp', 'OPTIONS')).toBeNull()
  })
})
