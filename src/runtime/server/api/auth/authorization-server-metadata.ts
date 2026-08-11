import { createAuthProxyHandler } from './[...]'

// RFC 8414 inserts the issuer path after the well-known segment. The fixed
// upstream alias remains provider-owned; Nuxt never constructs OAuth metadata.
export default createAuthProxyHandler({
  allowedMethods: ['GET', 'HEAD'],
  fixedAuthPath: '/.well-known/oauth-authorization-server',
  publicMetadataCors: true,
})
