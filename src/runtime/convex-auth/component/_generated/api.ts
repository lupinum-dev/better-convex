/* eslint-disable */
/** Generated Convex API utility. */
import type * as adapter from '../adapter.js'
import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server'
import { anyApi, componentsGeneric } from 'convex/server'

const fullApi: ApiFromModules<{ adapter: typeof adapter }> = anyApi as any

export const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>> = anyApi as any
export const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>> = anyApi as any
export const components = componentsGeneric() as unknown as {}
