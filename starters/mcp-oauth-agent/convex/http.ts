import { httpRouter } from 'convex/server'

import { auth } from './auth'
import { handleMcp } from './mcp'

const http = httpRouter()

auth.registerRoutes(http)
// GET and DELETE reach the handler's deliberate 405 instead of a router 404.
for (const method of ['POST', 'GET', 'DELETE'] as const) {
  http.route({ path: '/mcp', method, handler: handleMcp })
}
// Credential-free discovery for browser-based clients. Convex serves HEAD through GET.
for (const method of ['GET', 'OPTIONS'] as const) {
  http.route({ path: '/.well-known/oauth-protected-resource/mcp', method, handler: handleMcp })
}

export default http
