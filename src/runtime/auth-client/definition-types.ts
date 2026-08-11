import type { BetterAuthClientOptions, BetterAuthClientPlugin } from 'better-auth/client'

/** Internal generic inputs shared by the public definition and its runtime validator. */
export type AuthClientPlugins = readonly BetterAuthClientPlugin[]

export type ConvexAuthClientDefinitionOptions<Plugins extends AuthClientPlugins> = Omit<
  BetterAuthClientOptions,
  'baseURL' | 'basePath' | 'plugins' | 'fetchOptions'
> & {
  plugins?: Plugins
}
