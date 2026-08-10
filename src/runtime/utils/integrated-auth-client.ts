/**
 * Keep provider methods while removing transport and token-authority escape
 * hatches owned by the Nuxt runtime.
 */
export type IntegratedAuthClient<Client extends object> = Omit<
  Client,
  '$fetch' | '$store' | 'hydrateSession' | 'convex'
>
