import { httpRouter } from 'convex/server'

import { auth } from './auth'
import { handleMcp } from './mcp'
import { registerMcpOAuthFixtureRoutes } from './mcpOAuthAdmin'

const http = httpRouter()

auth.registerRoutes(http)
registerMcpOAuthFixtureRoutes(http)
http.route({ handler: handleMcp, method: 'POST', path: '/mcp' })
http.route({ handler: handleMcp, method: 'GET', path: '/mcp' })
http.route({ handler: handleMcp, method: 'DELETE', path: '/mcp' })
http.route({
  handler: handleMcp,
  method: 'GET',
  path: '/.well-known/oauth-protected-resource/mcp',
})
http.route({
  handler: handleMcp,
  method: 'OPTIONS',
  path: '/.well-known/oauth-protected-resource/mcp',
})

export default http
