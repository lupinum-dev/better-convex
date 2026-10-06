import type { CallToolResult, InputRequiredResult } from '@modelcontextprotocol/server'

export type McpToolResult = CallToolResult | InputRequiredResult

/**
 * Sanitized diagnostics for one failed tool call. It never carries the thrown value, its message,
 * stack, cause, or tool arguments. `code` is present only when the failure was an allowlisted
 * `ConvexError` code projected to the client.
 */
export interface McpToolErrorMetadata {
  readonly kind: 'tool'
  readonly name: string
  readonly code?: string
}

export interface ProjectMcpToolErrorOptions {
  /** Additional `ConvexError` `data.code` values whose message the client may see. */
  readonly expose?: readonly string[]
}

export interface RunMcpToolOptions extends ProjectMcpToolErrorOptions {
  readonly name: string
  readonly onToolError?: (metadata: McpToolErrorMetadata) => void | Promise<void>
}

/** Generic messages for auth codes; custom messages still require explicit exposure. */
const alwaysExposed: Readonly<Record<string, string>> = Object.freeze({
  UNAUTHENTICATED: 'Authentication is required.',
  MCP_ACCESS_DENIED: 'This connection is no longer allowed to access this data.',
  MCP_INSUFFICIENT_SCOPE: 'This connection lacks the permission this tool requires.',
})

const defaultExposedMessage = 'The request could not be completed.'
const maximumMessageLength = 1_000
const codePattern = /^[A-Z][A-Z0-9_]{0,63}$/u

function safeToolName(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
    })
  ) {
    throw new TypeError('Invalid MCP tool name')
  }
  return value
}

export function exposedMcpErrorCodes(expose: readonly string[] | undefined): ReadonlySet<string> {
  if (expose === undefined) return new Set()
  if (!Array.isArray(expose)) throw new TypeError('Invalid MCP exposed error codes')
  for (const code of expose) {
    if (typeof code !== 'string' || !codePattern.test(code)) {
      throw new TypeError('Invalid MCP exposed error code')
    }
  }
  return new Set(expose)
}

/** `instanceof ConvexError` fails across duplicated Convex copies; the marker does not. */
function convexErrorData(error: unknown): { found: boolean; data?: unknown } {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return { found: false }
  }
  try {
    if ((error as Record<PropertyKey, unknown>)[Symbol.for('ConvexError')] !== true) {
      return { found: false }
    }
    return { found: true, data: (error as { data?: unknown }).data }
  } catch {
    return { found: false }
  }
}

function ownField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function safeMessage(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maximumMessageLength ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)
      return (
        codePoint !== undefined &&
        ((codePoint <= 31 && codePoint !== 10) || (codePoint >= 127 && codePoint <= 159))
      )
    })
  ) {
    return undefined
  }
  return value
}

function projectWith(
  error: unknown,
  exposed: ReadonlySet<string>,
): { code: string; result: CallToolResult } | undefined {
  const convex = convexErrorData(error)
  if (!convex.found) return undefined
  const data = convex.data
  const code = typeof data === 'string' ? data : ownField(data, 'code')
  if (
    typeof code !== 'string' ||
    !codePattern.test(code) ||
    !(Object.hasOwn(alwaysExposed, code) || exposed.has(code))
  ) {
    return undefined
  }
  const message =
    (exposed.has(code) ? safeMessage(ownField(data, 'message')) : undefined) ??
    alwaysExposed[code] ??
    defaultExposedMessage
  const retryable = exposed.has(code) && ownField(data, 'retryable') === true
  return {
    code,
    result: {
      isError: true,
      content: [{ type: 'text', text: message }],
      structuredContent: { error: { code, message, retryable } },
    },
  }
}

/**
 * Projects an allowlisted `ConvexError` into an MCP tool error the model can act on.
 *
 * Only `data.code` values in `expose` (plus `UNAUTHENTICATED`, `MCP_ACCESS_DENIED` and
 * `MCP_INSUFFICIENT_SCOPE`) are projected. Developer-authored `data.message` and
 * `data.retryable` require `expose`; auth codes otherwise use static generic messages.
 * Returns `undefined` for anything else; callers then fall back to one static failure
 * so unexpected internals never reach the client.
 */
export function projectMcpToolError(
  error: unknown,
  options?: ProjectMcpToolErrorOptions,
): CallToolResult | undefined {
  return projectWith(error, exposedMcpErrorCodes(options?.expose))?.result
}

/**
 * Runs one tool operation and converts throws into a client-safe MCP tool result: allowlisted
 * `ConvexError` codes become structured errors, and anything else becomes one static failure.
 *
 * Expected domain outcomes may still be returned as ordinary official tool results. This helper
 * does not sanitize SDK input/output validation failures or callbacks that do not call it.
 */
export const runToolSafely = async (
  operation: () => McpToolResult | Promise<McpToolResult>,
  options?: RunMcpToolOptions,
): Promise<McpToolResult> => {
  const name = options === undefined ? undefined : safeToolName(options.name)
  const exposed = exposedMcpErrorCodes(options?.expose)
  try {
    return await operation()
  } catch (error) {
    const projected = projectWith(error, exposed)
    if (name !== undefined && options?.onToolError) {
      const code = projected?.code
      try {
        await options.onToolError(
          Object.freeze(code === undefined ? { kind: 'tool', name } : { kind: 'tool', name, code }),
        )
      } catch {
        // Diagnostics must not change the client-visible tool result.
      }
    }
    return (
      projected?.result ?? {
        content: [{ type: 'text', text: 'Tool execution failed' }],
        isError: true,
      }
    )
  }
}
