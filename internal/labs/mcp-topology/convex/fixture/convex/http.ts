import { httpRouter } from 'convex/server'

import { getInteractionPage, postInteractionConfirmation } from './interaction_page'
import { INTERACTION_PATH_PREFIX } from './interaction_page_contract'
import { handleMcp, handleOAuthMetadata } from './mcp'

const http = httpRouter()

http.route({ handler: handleMcp, method: 'POST', path: '/mcp' })
http.route({ handler: handleMcp, method: 'GET', path: '/mcp' })
http.route({ handler: handleMcp, method: 'DELETE', path: '/mcp' })
http.route({
  handler: handleOAuthMetadata,
  method: 'GET',
  path: '/.well-known/oauth-protected-resource/mcp',
})
http.route({
  handler: handleOAuthMetadata,
  method: 'OPTIONS',
  path: '/.well-known/oauth-protected-resource/mcp',
})
http.route({
  handler: handleOAuthMetadata,
  method: 'GET',
  path: '/.well-known/oauth-authorization-server',
})
http.route({
  handler: getInteractionPage,
  method: 'GET',
  pathPrefix: INTERACTION_PATH_PREFIX,
})
http.route({
  handler: postInteractionConfirmation,
  method: 'POST',
  pathPrefix: INTERACTION_PATH_PREFIX,
})

export default http
