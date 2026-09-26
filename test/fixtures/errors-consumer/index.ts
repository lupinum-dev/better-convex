/**
 * Standalone packed-probe consumer (packed consumer fixture).
 *
 * Imports ONLY `@lupinum/better-convex-nuxt/errors` — no other subpath, no Nuxt, no Vue
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
  isConvexCallError,
  isSerializedConvexCallError,
  normalizeConvexError,
} from '@lupinum/better-convex-nuxt/errors'
import type { ConvexCallErrorCode, ConvexCallErrorKind } from '@lupinum/better-convex-nuxt/errors'
import { ConvexError } from 'convex/values'

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

// The call context names the failing function without replacing a known one.
const named = normalizeConvexError(original, { functionName: 'notes:create' })
if (named === original || named.kind !== 'transport' || named.functionName !== 'notes:create') {
  fail('normalizeConvexError did not attach the context function name to a copy')
}
if (normalizeConvexError(named, { functionName: 'notes:other' }).functionName !== 'notes:create') {
  fail('normalizeConvexError replaced an existing function name')
}

// Application errors keep developer-authored text; Convex's wire message never leaks.
const stringData = normalizeConvexError(new ConvexError('Title is required'), {
  functionName: 'notes:create',
})
if (
  stringData.kind !== 'server' ||
  stringData.message !== 'Title is required' ||
  stringData.functionName !== 'notes:create'
) {
  fail('a string ConvexError payload did not become the public message')
}
const structured = normalizeConvexError(
  new ConvexError({ code: 'NOTE_EXISTS', message: 'A note with this title exists' }),
)
if (structured.code !== 'NOTE_EXISTS' || structured.message !== 'A note with this title exists') {
  fail('a structured ConvexError payload did not keep its code and message')
}
if (
  normalizeConvexError(new ConvexError({ code: 'NOTE_EXISTS' })).message !==
  'Convex application error'
) {
  fail('a ConvexError payload without text did not use the generic message')
}

// Library failures carry stable codes and survive the serialized round trip.
const cancelledCode: ConvexCallErrorCode = 'CANCELLED'
const cancelled = new ConvexCallError({
  kind: 'unknown',
  code: cancelledCode,
  message: 'Upload cancelled',
  functionName: 'files:generateUploadUrl',
})
if (!isConvexCallError(cancelled, 'CANCELLED') || !isConvexCallError(cancelled)) {
  fail('isConvexCallError rejected a matching ConvexCallError')
}
if (isConvexCallError(cancelled, 'IDENTITY_CHANGED') || isConvexCallError({ code: 'CANCELLED' })) {
  fail('isConvexCallError accepted a different code or a plain object')
}
const revived = normalizeConvexError(JSON.parse(JSON.stringify(cancelled)))
if (
  !(revived instanceof ConvexCallError) ||
  revived.code !== 'CANCELLED' ||
  revived.functionName !== 'files:generateUploadUrl'
) {
  fail('a serialized ConvexCallError did not revive with its code and function name')
}

console.log('errors-consumer OK')
