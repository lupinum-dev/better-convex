import { createAuthProxyHandler } from './[...]'

// Convex fetches the issuer's public signing keys server-to-server. This fixed,
// credential-free route must not depend on browser-ingress client-IP metadata.
export default createAuthProxyHandler({
  allowedMethods: ['GET', 'HEAD'],
  fixedAuthPath: '/jwks',
  publicMetadataCors: true,
})
