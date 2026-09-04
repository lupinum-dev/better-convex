import { testUtils, type TestHelpers } from 'better-auth/plugins'
/*
 * Adapted from get-convex/better-auth at
 * c628916b451a6b4cff0f5464f134475464b1a6da (Apache-2.0).
 */
import type { GenericDataModel, GenericSchema, SchemaDefinition } from 'convex/server'

import schema from './component/schema'
import {
  createBetterConvexAuthOwned,
  type BetterConvexAuth,
  type BetterConvexAuthInstance,
  type CreateBetterConvexAuthOptions,
} from './create-better-convex-auth'
import type { AuthAdapterComponentApi } from './types'

type ComponentModules = Record<string, () => Promise<unknown>>

interface ComponentRegistrar {
  registerComponent(
    name: string,
    schema: SchemaDefinition<GenericSchema, boolean>,
    modules: ComponentModules,
  ): void
}

interface BetterAuthTestHelper {
  modules: ComponentModules
  register: typeof register
  schema: SchemaDefinition<GenericSchema, boolean>
}

export interface BetterConvexTestAuthInstance extends BetterConvexAuthInstance {
  readonly $context: Promise<{ readonly test: TestHelpers } & Record<string, unknown>>
}

function requireLoopbackOrigin(name: 'CONVEX_SITE_URL' | 'SITE_URL'): void {
  const value = process.env[name]
  if (!value) throw new Error('AUTH_TEST_LOOPBACK_REQUIRED')
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('AUTH_TEST_LOOPBACK_REQUIRED')
    }
  } catch {
    throw new Error('AUTH_TEST_LOOPBACK_REQUIRED')
  }
}

function requireLoopbackOrigins(): void {
  requireLoopbackOrigin('SITE_URL')
  requireLoopbackOrigin('CONVEX_SITE_URL')
}

/**
 * Create the normal Better Convex auth unit with Better Auth's test helpers.
 * This entry refuses non-loopback runtimes and offers no arbitrary plugin seam.
 */
export function createBetterConvexTestAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(
  component: Api,
  options: CreateBetterConvexAuthOptions<DataModel>,
): BetterConvexAuth<DataModel, Api, BetterConvexTestAuthInstance> {
  requireLoopbackOrigins()
  return createBetterConvexAuthOwned<DataModel, Api>(
    component,
    options,
    [testUtils()],
    requireLoopbackOrigins,
  ) as BetterConvexAuth<DataModel, Api, BetterConvexTestAuthInstance>
}

// Keep this map static so the compiled npm entry works in plain Node as well
// as under Vite. The generated key establishes convex-test's component root;
// adapter is the only component function module.
const modules: ComponentModules = {
  './component/_generated/api.js': () => import('./component/_generated/api.js'),
  './component/adapter.js': () => import('./component/adapter.js'),
}

export function register(test: ComponentRegistrar, name = 'betterAuth'): void {
  test.registerComponent(name, schema, modules)
}

const testHelper: BetterAuthTestHelper = { modules, register, schema }

export default testHelper
