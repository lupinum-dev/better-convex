import {
  guarded,
  maximumUploadBytes,
  uploadTypes,
  type LibraryDataModel,
  type UploadType,
} from '@lupinum/better-convex-functions/internal'
import {
  httpActionGeneric,
  type FunctionReference,
  type GenericMutationCtx,
  type HttpRouter,
} from 'convex/server'
import type { GenericId } from 'convex/values'

import { within, type Budget } from './budget'
import { discard } from './transport'

type Lib = GenericMutationCtx<LibraryDataModel>['db']

/** Upload links for agents: `defineTools(fns, modules, { functions, uploads })`. */
export interface UploadsOption {
  /** OAuth scopes whose connections may ask for upload links, for example `['write']`. */
  scopes: readonly string[]
  /** The file types a link takes, decided from each file's first bytes. */
  types: readonly UploadType[]
  /** The largest file a link takes, in bytes: at most 20 MiB, Convex's request limit. */
  maxBytes: number
  /** Where `uploadRoute` listens in `convex/http.ts`. Default `/mcp/upload`. */
  path?: string
}

/** The checked option, as `defineTools` keeps it, with the route's two functions. */
export interface Uploads {
  scopes: readonly string[]
  types: readonly UploadType[]
  maxBytes: number
  path: string
  ticket: FunctionReference<'query', 'internal'>
  stored: FunctionReference<'mutation', 'internal'>
}

/** Links one `request_upload` call hands out, and files one actor may leave unclaimed. */
export const uploadsPerRequest = 20
export const unclaimedPerActor = 100
/** The names of the upload functions `defineTools` adds; app tools cannot use them. */
export const uploadFunctionNames = ['request_upload', 'upload_ticket', 'upload_stored'] as const

/** Checks the option when `defineTools` runs, so a wrong one fails at deploy, not at the first upload. */
export function checkUploads(
  option: UploadsOption,
  policyScopes: readonly string[],
): Omit<Uploads, 'ticket' | 'stored'> {
  const { scopes, types, maxBytes, path = '/mcp/upload' } = option
  if (!Array.isArray(scopes) || scopes.length === 0)
    throw new Error('uploads.scopes: name the scopes whose connections may upload files.')
  for (const scope of scopes)
    if (!policyScopes.includes(scope))
      throw new Error(`uploads.scopes: ${JSON.stringify(scope)} is not a scope of the policy.`)
  if (!Array.isArray(types) || types.length === 0)
    throw new Error('uploads.types: name the file types the links take.')
  for (const type of types)
    if (!(uploadTypes as readonly string[]).includes(type))
      throw new Error(
        `uploads.types: ${JSON.stringify(type)} is not a type the library can check. Use ${uploadTypes.join(', ')}.`,
      )
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > maximumUploadBytes)
    throw new Error(`uploads.maxBytes: a whole number of bytes from 1 to ${maximumUploadBytes}.`)
  // `request_upload` resolves the path against the site URL: `//host/x` would point at another host.
  if (
    typeof path !== 'string' ||
    !/^(?:\/[\w.~-]+)+$/.test(path) ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(path)
  )
    throw new Error('uploads.path: a route path such as /mcp/upload.')
  return { scopes: [...scopes], types: [...types], maxBytes, path }
}

/**
 * The type of a file from its first bytes, or `undefined` for anything else.
 * A signature wins over text: a file that starts like a PDF is a PDF, even
 * for a link that takes only CSV. CSV has no signature: it is UTF-8 text
 * without control characters other than tab and line breaks, and the app's
 * own parser decides the rest.
 */
export function sniff(bytes: Uint8Array): UploadType | undefined {
  const at = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte)
  // Decimal bytes: the formatter and the linter disagree on hex case.
  if (at([37, 80, 68, 70, 45])) return 'application/pdf' // %PDF-
  if (at([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png'
  if (at([255, 216, 255])) return 'image/jpeg'
  if (at([82, 73, 70, 70]) && at([87, 69, 66, 80], 8)) return 'image/webp' // RIFF....WEBP
  if (bytes.length === 0) return undefined
  // Decoded in pieces, so a large file is never held as one string next to its bytes.
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let offset = 0; offset < bytes.length; offset += textPieceBytes) {
    const end = offset + textPieceBytes
    let text: string
    try {
      text = decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.length })
    } catch {
      return undefined
    }
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      // Tab, line feed and carriage return are text; other control characters are not.
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return undefined
    }
  }
  return 'text/csv'
}

const textPieceBytes = 64 * 1024

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A one-time token: 244 random bits, with a prefix that secret scanners can match. */
export function newToken(): string {
  return `bcu_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
}

/**
 * Deletes upload rows past their end, within `budget`: open links, stored
 * files nobody claimed (with their bytes), and the records of claimed files
 * (the file stays: it belongs to the app row that claimed it). True when
 * nothing is left.
 */
export async function deleteExpiredUploads(
  db: Lib,
  storage: { delete: (id: GenericId<'_storage'>) => Promise<void> },
  now: number,
  budget: Budget,
): Promise<boolean> {
  for (const status of ['open', 'stored', 'claimed'] as const) {
    const { rows, more } = await within(
      db
        .query('uploads')
        .withIndex('by_status_expires', (q) => q.eq('status', status).lt('expiresAt', now)),
      budget,
    )
    for (const row of rows) {
      if (row.status === 'stored' && row.storageId) await storage.delete(row.storageId)
      await db.delete(row._id)
    }
    if (more) return false
  }
  return true
}

/** What `uploadRoute` needs from the module that calls `defineTools`. */
interface UploadsModule {
  tools: { uploads?: Uploads; functions: Record<string, unknown> }
  [name: string]: unknown
}

const refusedBodyBytes = 4 * 1024 * 1024

function refused(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * The upload route: an agent sends a file's bytes here with a token from
 * `request_upload`. Add it to `convex/http.ts`:
 * `http.route(uploadRoute(agents))`.
 *
 * The route checks the token before it reads the body, reads at most the
 * link's size, decides the type from the first bytes, and stores the file only
 * when the type is one the link takes. A token works once. The answer is
 * `{ uploadId, type, size, sha256 }`; the agent passes `uploadId` to the tool
 * that takes the file, and that tool calls `claimUpload`.
 */
export function uploadRoute(agents: UploadsModule): Parameters<HttpRouter['route']>[0] {
  const uploads = agents.tools?.uploads
  if (!uploads)
    throw new Error(
      'uploadRoute: turn uploads on in defineTools: defineTools(fns, modules, { functions, uploads: { scopes, types, maxBytes } }).',
    )
  const missing = ['upload_ticket', 'upload_stored'].filter(
    (name) => !agents[name] || agents[name] !== agents.tools.functions[name],
  )
  if (missing.length > 0)
    throw new Error(
      `Not exported from the agents module: ${missing.join(', ')}. Add them to \`export const { ${missing.join(', ')} } = tools.functions\`.`,
    )
  const { ticket: ticketRef, stored: storedRef } = uploads
  const invalidLink =
    'This upload link is not valid: it expired, was used, or never existed. Ask for a new one with request_upload.'

  const handler = guarded(
    httpActionGeneric(async (ctx, request) => {
      /**
       * Reads a refused body to its end first: Convex's edge answers 520
       * otherwise. Up to 4 MiB for a caller without a valid token, up to the
       * request limit for the holder of one, so a too large file gets its 413.
       */
      const refuse = async (
        status: number,
        code: string,
        message: string,
        drain = refusedBodyBytes,
      ) => {
        const declared = Number(request.headers.get('content-length') ?? '0')
        if (request.body && !request.bodyUsed && declared <= drain)
          await discard(request.body.getReader(), undefined, drain)
        return refused(status, code, message)
      }
      const match = /^Bearer (bcu_[0-9a-f]{64})$/.exec(request.headers.get('authorization') ?? '')
      if (!match) return refuse(401, 'NOT_SIGNED_IN', invalidLink)
      const tokenHash = await sha256Hex(new TextEncoder().encode(match[1]))
      const ticket = (await ctx.runQuery(ticketRef, { tokenHash })) as {
        maxBytes: number
        types: string[]
      } | null
      if (!ticket) return refuse(401, 'NOT_SIGNED_IN', invalidLink)
      const tooLarge = `The file is larger than ${ticket.maxBytes} bytes, the most this link takes.`
      const declared = request.headers.get('content-length')
      let expected: number | undefined
      if (declared !== null) {
        expected = Number(declared)
        if (!Number.isSafeInteger(expected) || expected < 0)
          return refuse(400, 'INVALID_INPUT', 'The Content-Length header is not a number.')
        if (expected > ticket.maxBytes)
          return refuse(413, 'TOO_LARGE', tooLarge, maximumUploadBytes)
      }
      if (!request.body) return refuse(400, 'INVALID_INPUT', 'Send the file as the request body.')
      const bytes = await readAtMost(request.body, ticket.maxBytes, expected)
      if (!bytes) return refused(413, 'TOO_LARGE', tooLarge)
      if (bytes.byteLength === 0)
        return refused(
          400,
          'INVALID_INPUT',
          'The request body is empty. Send the file as the body.',
        )
      const type = sniff(bytes)
      if (!type || !ticket.types.includes(type))
        return refused(
          415,
          'INVALID_INPUT',
          `This file is not one of ${ticket.types.join(', ')} (the type comes from the file's first bytes, not its name).`,
        )
      const sha256 = await sha256Hex(bytes)
      const storageId = await ctx.storage.store(new Blob([bytes], { type }))
      let uploadId: string | null
      try {
        uploadId = (await ctx.runMutation(storedRef, {
          tokenHash,
          storageId,
          type,
          size: bytes.byteLength,
          sha256,
        })) as string | null
      } catch (error) {
        // No row points at the file, so housekeeping would never find it.
        await ctx.storage.delete(storageId).catch(() => undefined)
        throw error
      }
      if (!uploadId) {
        // The token was used or expired while this file arrived: keep nothing.
        await ctx.storage.delete(storageId)
        return refused(401, 'NOT_SIGNED_IN', invalidLink)
      }
      return new Response(JSON.stringify({ uploadId, type, size: bytes.byteLength, sha256 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  return { path: uploads.path, method: 'POST', handler } as Parameters<HttpRouter['route']>[0]
}

/**
 * The whole body as bytes, or `null` once it passes `maximum` bytes. With a
 * known length the bytes go into one buffer of that size, so a file near the
 * limit is held once, not twice, in the action's 64 MiB of memory.
 */
async function readAtMost(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  expected: number | undefined,
) {
  const reader = stream.getReader()
  let buffer = new Uint8Array(expected ?? Math.min(maximum, textPieceBytes))
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const end = total + value.byteLength
      if (end > maximum) {
        // The caller holds a valid link: read on, so the answer is a 413 and not a 520.
        await discard(reader, undefined, maximumUploadBytes - end)
        return null
      }
      if (end > buffer.byteLength) {
        const grown = new Uint8Array(Math.min(maximum, Math.max(buffer.byteLength * 2, end)))
        grown.set(buffer.subarray(0, total))
        buffer = grown
      }
      buffer.set(value, total)
      total = end
    }
  } finally {
    reader.releaseLock()
  }
  return buffer.subarray(0, total)
}
