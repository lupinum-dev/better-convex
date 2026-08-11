/*
 * Adapted from get-convex/better-auth at
 * c628916b451a6b4cff0f5464f134475464b1a6da (Apache-2.0).
 */
import type { GenericSchema, SchemaDefinition } from 'convex/server'

import schema from './component/schema'

type ComponentModules = Record<string, () => Promise<unknown>>

interface ComponentRegistrar {
  registerComponent(
    name: string,
    schema: SchemaDefinition<GenericSchema, boolean>,
    modules: ComponentModules,
  ): void
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

export default { modules, register, schema }
