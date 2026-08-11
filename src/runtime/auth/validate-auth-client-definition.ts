// Runtime validation for the resolved auth-client definition (public
// "Client instantiation" item 2). TypeScript already forbids `baseURL`,
// `basePath`, and `fetchOptions` on `ConvexAuthClientDefinitionOptions`, but a
// JavaScript / untyped consumer can still pass them (or a malformed `plugins`
// value). The auth-enabled client plugin runs this before creating the Better
// Auth client so those mistakes fail loudly instead of silently breaking token
// transport or duplicating the Convex plugin.
//
// Framework-free logic (no Nuxt/Vue imports). It lives alongside the auth engine
// rather than inside the published `/auth-client` entry because that entry
// exports exactly one runtime value (`defineConvexAuthClient`).

import type { ConvexAuthClientDefinition } from '../auth-client'
import type {
  AuthClientPlugins,
  ConvexAuthClientDefinitionOptions,
} from '../auth-client/definition-types'

/** Own keys the library owns; a consumer may not set them. */
const FORBIDDEN_OWN_KEYS = ['baseURL', 'basePath', 'fetchOptions'] as const

/** The stable id of the single Convex client plugin the library prepends. */
const CONVEX_PLUGIN_ID = 'convex'

export class ConvexAuthClientDefinitionError extends TypeError {
  constructor(message: string) {
    super(`[better-convex-nuxt] invalid auth-client definition: ${message}`)
    this.name = 'ConvexAuthClientDefinitionError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Validate a resolved definition object and return its `options`. Throws a
 * `ConvexAuthClientDefinitionError` on any forbidden key, non-array/malformed
 * `plugins`, or a consumer plugin whose stable `id` collides with the reserved
 * Convex plugin id.
 */
export function validateConvexAuthClientDefinition<Plugins extends AuthClientPlugins>(
  definition: ConvexAuthClientDefinition<Plugins> | unknown,
): ConvexAuthClientDefinitionOptions<Plugins> {
  if (!isRecord(definition) || !isRecord((definition as { options?: unknown }).options)) {
    throw new ConvexAuthClientDefinitionError(
      'expected a `defineConvexAuthClient({ ... })` result with an `options` object.',
    )
  }

  const options = (definition as { options: Record<string, unknown> }).options

  for (const key of FORBIDDEN_OWN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      throw new ConvexAuthClientDefinitionError(
        `\`${key}\` is owned by the module and cannot be set on the definition.`,
      )
    }
  }

  const { plugins } = options as { plugins?: unknown }
  if (plugins !== undefined) {
    if (!Array.isArray(plugins)) {
      throw new ConvexAuthClientDefinitionError(
        '`plugins` must be an array of Better Auth client plugins.',
      )
    }
    for (const [index, plugin] of plugins.entries()) {
      if (!isRecord(plugin) || typeof (plugin as { id?: unknown }).id !== 'string') {
        throw new ConvexAuthClientDefinitionError(
          `plugins[${index}] is not a valid Better Auth client plugin (missing string \`id\`).`,
        )
      }
      if ((plugin as { id: string }).id === CONVEX_PLUGIN_ID) {
        throw new ConvexAuthClientDefinitionError(
          `plugins[${index}] uses the reserved id \`${CONVEX_PLUGIN_ID}\`; the module prepends the Convex client plugin itself.`,
        )
      }
    }
  }

  return options as unknown as ConvexAuthClientDefinitionOptions<Plugins>
}
