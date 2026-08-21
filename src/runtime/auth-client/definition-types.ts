import type { oauthProviderClient } from '@better-auth/oauth-provider/client'
import type { BetterAuthClientOptions } from 'better-auth/client'
import type {
  emailOTPClient,
  oauthPopupClient,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins'

type AdmittedAuthClientPlugin =
  | ReturnType<typeof oauthProviderClient>
  | ReturnType<typeof organizationClient>
  | ReturnType<typeof twoFactorClient>
  | ReturnType<typeof emailOTPClient>
  | ReturnType<typeof oauthPopupClient>

/** The client half of the reviewed server capability profile. */
export type AuthClientPlugins = readonly AdmittedAuthClientPlugin[]

export type ConvexAuthClientDefinitionOptions<Plugins extends AuthClientPlugins> = Omit<
  BetterAuthClientOptions,
  'baseURL' | 'basePath' | 'plugins' | 'fetchOptions'
> & {
  plugins?: Plugins
}
