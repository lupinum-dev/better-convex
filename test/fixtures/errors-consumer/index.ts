/**
 * Standalone packed-probe consumer (packed consumer fixture).
 *
 * Imports ONLY `better-convex-nuxt/errors` — no other subpath, no Nuxt, no Vue
 * — and exercises the framework-free contract from a real node_modules-
 * resident install of the packed tarball. Runnable standalone:
 *
 *   pnpm install && pnpm run build && pnpm run start
 *
 * or driven end-to-end by `scripts/check-package-exports.mjs`'s packed probe,
 * which packs the current tree, installs the tarball here, then runs `build`
 * (type resolution) and `start` (runtime resolution + behavioral assertions).
 */
import {
  ConvexCallError,
  isSerializedConvexCallError,
  normalizeConvexError,
} from 'better-convex-nuxt/errors'
import type { ConvexCallErrorKind } from 'better-convex-nuxt/errors'

const typedKind: ConvexCallErrorKind = 'server'
void typedKind

function fail(message: string): never {
  console.error(`errors-consumer FAILED: ${message}`)
  process.exit(1)
}

// An existing ConvexCallError passes through the normalizer unchanged.
const original = new ConvexCallError({ kind: 'transport', message: 'network down' })
const passedThrough = normalizeConvexError(original)
if (passedThrough !== original) {
  fail('normalizeConvexError did not pass through an existing ConvexCallError unchanged')
}

// An arbitrary Error normalizes to `unknown` — never to `transport` by guessing.
const normalized = normalizeConvexError(new Error('boom'))
if (!(normalized instanceof ConvexCallError)) {
  fail('normalizeConvexError did not return a ConvexCallError instance')
}
if (normalized.kind !== 'unknown') {
  fail(`expected kind "unknown", got "${String(normalized.kind)}"`)
}
if (normalized.message !== 'Unknown Convex error') {
  fail(`expected opaque message, got "${normalized.message}"`)
}

const json = normalized.toJSON()
if (json.name !== 'ConvexCallError') fail('toJSON().name !== "ConvexCallError"')
if (json.kind !== 'unknown') fail('toJSON().kind !== "unknown"')
if (json.message !== 'Unknown Convex error') fail('toJSON().message is not opaque')
if ('cause' in json) fail('toJSON() must never include "cause"')

if (!isSerializedConvexCallError(json)) {
  fail('isSerializedConvexCallError rejected a well-formed serialized shape')
}
if (isSerializedConvexCallError({ name: 'ConvexCallError' })) {
  fail(
    'isSerializedConvexCallError accepted a bare { name } object (must do strict structural validation)',
  )
}

console.log('errors-consumer OK')
