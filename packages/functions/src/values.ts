import { convexToJson, getConvexSize, type Value } from 'convex/values'

/**
 * Values that cross a door: tool input from a model, results stored for
 * replay, text a person reads. Validated and normalised here once, so both
 * doors (MCP and the in-app agent) behave the same.
 */

export type ValidatorJson =
  | { type: 'null' | 'number' | 'bigint' | 'boolean' | 'string' | 'bytes' | 'any' }
  | { type: 'literal'; value: unknown }
  | { type: 'id'; tableName: string }
  | { type: 'array'; value: ValidatorJson }
  | { type: 'record'; keys: ValidatorJson; values: { fieldType: ValidatorJson } }
  | { type: 'object'; value: Record<string, { fieldType: ValidatorJson; optional: boolean }> }
  | { type: 'union'; value: ValidatorJson[] }

export const jsonOf = (validator: unknown) => (validator as { json: ValidatorJson }).json

/** Every ID an input names, at any depth, with its table. In a union, a string may belong to another member: check it. */
export function idsIn(json: ValidatorJson, value: unknown): { table: string; id: string }[] {
  if (value === undefined || value === null) return []
  switch (json.type) {
    case 'id':
      return typeof value === 'string' ? [{ table: json.tableName, id: value }] : []
    case 'array':
      return Array.isArray(value) ? value.flatMap((item) => idsIn(json.value, item)) : []
    case 'object':
      return typeof value === 'object'
        ? Object.entries(json.value).flatMap(([key, field]) =>
            idsIn(field.fieldType, (value as Record<string, unknown>)[key]),
          )
        : []
    case 'record':
      // Keys can be IDs too (`v.record(v.id('notes'), …)`).
      return typeof value === 'object'
        ? Object.entries(value).flatMap(([key, item]) => [
            ...idsIn(json.keys, key),
            ...idsIn(json.values.fieldType, item),
          ])
        : []
    case 'union':
      return json.value.flatMap((member) => idsIn(member, value))
    default:
      return []
  }
}

/**
 * Does a value Convex already accepted fit this validator? For a union, it tells which members
 * the value is: only their fields carry meaning. `isId(table, value)` checks an ID's table.
 */
export function matches(
  json: ValidatorJson,
  value: unknown,
  isId: (table: string, value: string) => boolean,
): boolean {
  switch (json.type) {
    case 'any':
      return true
    case 'null':
      return value === null
    case 'number':
    case 'bigint':
    case 'boolean':
    case 'string':
      return typeof value === json.type
    case 'bytes':
      return value instanceof ArrayBuffer
    case 'literal':
      return value === json.value
    case 'id':
      return typeof value === 'string' && isId(json.tableName, value)
    case 'array':
      return Array.isArray(value) && value.every((item) => matches(json.value, item, isId))
    case 'record':
      return (
        isPlainObject(value) &&
        Object.entries(value).every(
          ([key, item]) =>
            matches(json.keys, key, isId) && matches(json.values.fieldType, item, isId),
        )
      )
    case 'object':
      return (
        isPlainObject(value) &&
        Object.keys(value).every((key) => Object.hasOwn(json.value, key)) &&
        Object.entries(json.value).every(([key, field]) => {
          const item = value[key]
          return item === undefined ? field.optional : matches(field.fieldType, item, isId)
        })
      )
    case 'union':
      return json.value.some((member) => matches(member, value, isId))
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer)
  )
}

/** Identifies one call (tool and input, key order ignored), so a reused retry key is detected. */
export function callKey(tool: string, input: unknown): string {
  return `${tool}:${hash(stable(input))}`
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

/**
 * A fingerprint of a stored row: bytes and int64 fields included (as Convex
 * encodes them). SHA-256, because someone who may write the row between a
 * request and its approval must not find a changed row with the same
 * fingerprint.
 */
export async function fingerprint(row: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stable(convexToJson(row as Value)))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** cyrb53: a short, fast, non-cryptographic string hash. Enough to tell two calls apart; a collision does no harm there. */
export function hash(text: string): string {
  let h1 = 3735928559 // 0xdeadbeef: the formatter and the linter disagree on hex case
  let h2 = 1103547991 // 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** A value to store for later replay, or a marker when it would make the row too large. */
export function storable(value: unknown, maxBytes = 64 * 1024): Value | undefined {
  if (value === undefined) return undefined
  const size = getConvexSize(value as Value)
  return size <= maxBytes ? (value as Value) : { truncated: true, bytes: size }
}

// Control characters, zero-width characters and bidirectional overrides: they hide or reorder text.
const invisible =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]+/g

/** One line of plain text, at most `max` characters. For text a person reads before deciding. */
export function oneLine(text: string, max = 300): string {
  const clean = text.replace(invisible, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * The same text for a model or a host that may render markdown: link, image,
 * HTML and emphasis syntax is escaped, so a project named
 * `[Approve here](https://…)` shows as text, not as a link.
 */
export function inertMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]()<>!#|~]/g, '\\$&').replace(/:\/\//g, ':\\/\\/')
}

/** Tool names every host accepts (OpenAI's rule is the strictest). */
export const toolNamePattern = /^[\w-]{1,64}$/

/** Convex validator JSON to the JSON Schema subset MCP hosts and models read. */
export function toJsonSchema(json: ValidatorJson, path = 'input'): Record<string, unknown> {
  switch (json.type) {
    case 'null':
      return { type: 'null' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'string':
      return { type: 'string' }
    case 'any':
      return {}
    case 'bigint':
    case 'bytes':
      throw new Error(
        `${path} uses v.${json.type === 'bigint' ? 'int64' : 'bytes'}(), which JSON cannot carry, so no agent can send it. Use v.number() or v.string() for tools.`,
      )
    case 'literal':
      // Validator JSON encodes a bigint literal as `{ $integer: … }`.
      if (json.value && typeof json.value === 'object')
        throw new Error(`${path} is a bigint literal, which JSON cannot carry.`)
      return { const: json.value }
    case 'id':
      return { type: 'string', description: `An ID from the ${json.tableName} table.` }
    case 'array':
      return { type: 'array', items: toJsonSchema(json.value, `${path}[]`) }
    case 'record':
      return {
        type: 'object',
        additionalProperties: toJsonSchema(json.values.fieldType, `${path}{}`),
      }
    case 'object': {
      const entries = Object.entries(json.value)
      return {
        type: 'object',
        properties: Object.fromEntries(
          entries.map(([key, field]) => [key, toJsonSchema(field.fieldType, `${path}.${key}`)]),
        ),
        required: entries.filter(([, field]) => !field.optional).map(([key]) => key),
        additionalProperties: false,
      }
    }
    case 'union':
      return { anyOf: json.value.map((member) => toJsonSchema(member, path)) }
  }
}

/**
 * The first object key Convex cannot carry ('$' first, non-ASCII, control
 * characters), as a path. No operation has such a field, so a door answers
 * "unknown field" before Convex refuses the whole call.
 */
function unsendableKey(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = unsendableKey(value[i], `${path}[${i}]`)
      if (found) return found
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  for (const [key, item] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key
    if (key.startsWith('$') || key.length > 1024 || /[^\x20-\x7E]/.test(key)) return here
    const found = unsendableKey(item, here)
    if (found) return found
  }
  return null
}

/** The door-side input check: what a model sent that no Convex function could receive. */
export function unsendable(input: unknown): { code: 'INVALID_INPUT'; message: string } | null {
  const key = unsendableKey(input)
  return key === null
    ? null
    : { code: 'INVALID_INPUT', message: `${key}: unknown field. Leave it out.` }
}

type Checked = { ok: true; value: unknown } | { ok: false; message: string }

/**
 * Checks tool input against the operation's validators and normalises what
 * models commonly send: `null` for an optional field means "left out".
 * Messages name the field and the expected type, never the value (it may be
 * long, or someone else's data the model pasted). `isId(table, value)` checks
 * an ID belongs to its table.
 */
export function checkInput(
  json: ValidatorJson,
  value: unknown,
  isId: (table: string, value: string) => boolean,
  path = '',
): Checked {
  const here = path || 'the input'
  const bad = (expected: string): Checked => ({
    ok: false,
    message: `${here}: expected ${expected}.`,
  })
  switch (json.type) {
    case 'any':
      return { ok: true, value }
    case 'null':
      return value === null ? { ok: true, value } : bad('null')
    case 'number':
      return typeof value === 'number' ? { ok: true, value } : bad('a number')
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : bad('true or false')
    case 'string':
      return typeof value === 'string' ? { ok: true, value } : bad('a string')
    case 'bigint':
    case 'bytes':
      return bad('a value JSON cannot carry')
    case 'literal':
      return value === json.value ? { ok: true, value } : bad(JSON.stringify(json.value))
    case 'id':
      return typeof value === 'string' && isId(json.tableName, value)
        ? { ok: true, value }
        : bad(`an ID from the ${json.tableName} table`)
    case 'array': {
      if (!Array.isArray(value)) return bad('a list')
      const out = []
      for (let i = 0; i < value.length; i++) {
        const item = checkInput(json.value, value[i], isId, `${path}[${i}]`)
        if (!item.ok) return item
        out.push(item.value)
      }
      return { ok: true, value: out }
    }
    case 'record': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('an object')
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) {
        const keyChecked = checkInput(json.keys, key, isId, `${path}{key}`)
        if (!keyChecked.ok) return keyChecked
        const checked = checkInput(json.values.fieldType, item, isId, path ? `${path}.${key}` : key)
        if (!checked.ok) return checked
        out[key] = checked.value
      }
      return { ok: true, value: out }
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('an object')
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(json.value, key))
          return {
            ok: false,
            message: `${path ? `${path}.${key}` : key}: unknown field. Leave it out.`,
          }
      }
      for (const [key, field] of Object.entries(json.value)) {
        const item = (value as Record<string, unknown>)[key]
        const name = path ? `${path}.${key}` : key
        if (
          item === undefined ||
          (item === null && field.optional && field.fieldType.type !== 'null')
        ) {
          if (!field.optional) return { ok: false, message: `${name}: required.` }
          continue
        }
        const checked = checkInput(field.fieldType, item, isId, name)
        if (!checked.ok) return checked
        out[key] = checked.value
      }
      return { ok: true, value: out }
    }
    case 'union': {
      for (const member of json.value) {
        const checked = checkInput(member, value, isId, path)
        if (checked.ok) return checked
      }
      // A union of literals reads best as a list of the allowed values.
      if (json.value.every((member) => member.type === 'literal')) {
        return bad(
          `one of ${json.value.map((member) => JSON.stringify((member as { value: unknown }).value)).join(', ')}`,
        )
      }
      return checkInput(json.value[0]!, value, isId, path)
    }
  }
}

/** A deep copy that throws when changed: what the library hands app code and relies on later. */
export function frozen<T>(value: T): T {
  const freeze = (item: unknown): unknown => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.freeze(item)
      for (const child of Object.values(item)) freeze(child)
    }
    return item
  }
  return freeze(structuredClone(value)) as T
}
