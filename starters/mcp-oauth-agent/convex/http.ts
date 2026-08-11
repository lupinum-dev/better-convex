import { httpRouter } from 'convex/server'

import { authComponent, createAuth } from './auth'
import { handleMcp } from './mcp'

const http = httpRouter()

authComponent.registerRoutes(http, createAuth)
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
