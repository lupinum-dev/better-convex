import type { FunctionReference } from 'convex/server'

// The MCP door's dispatch, without the door: this entry loads, and type-checks, without the
// optional MCP SDK.
import type { McpPrincipal } from './access.js'
import { grantedTools, toolCall, type CatalogEntry, type ToolSuccess } from './tools.js'

export type { ToolSuccess } from './tools.js'

/**
 * Calls a tool in convex-test as the MCP door does for a host: only a tool that the principal's
 * scopes unlock, with `input` sent through JSON and `request_id` taken from it, through the
 * tool's internal query or mutation. It resolves with the tool's output after the same JSON trip
 * (`structuredContent` at the door). It rejects with the tool's own error, as `t.mutation` does;
 * the door turns that error into an `isError` result. An output that is not JSON (a bigint)
 * rejects too.
 *
 * `principal` comes from `grantMcp` in `@lupinum/better-convex-nuxt/better-auth/test`.
 */
export async function callTool(
  test: {
    query(ref: FunctionReference<'query', 'internal'>, args: any): Promise<any>
    mutation(ref: FunctionReference<'mutation', 'internal'>, args: any): Promise<any>
  },
  tools: { catalog: readonly CatalogEntry[] },
  principal: McpPrincipal,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolSuccess> {
  const granted = grantedTools(tools.catalog, principal)
  const entry = granted.find((tool) => tool.name === name)
  if (!entry) {
    const unlocked = granted
      .filter((tool) => tool.scopes.length > 0)
      .map((tool) => tool.name)
      .sort()
    throw new Error(
      `callTool: no tool "${name}" for this principal. Its scopes unlock: ${unlocked.join(', ') || 'no tools'}.`,
    )
  }
  // A host's arguments reach the door as JSON. The same trip here: NaN becomes null, an undefined
  // field is dropped and a bigint throws, so a test cannot pass input that no host can send.
  const sent = JSON.parse(JSON.stringify(input)) as Record<string, unknown>
  const output = await toolCall(entry, sent, principal, {
    runQuery: (ref, args) => test.query(ref, args),
    runMutation: (ref, args) => test.mutation(ref, args),
  })
  // The door sends the output as JSON too: NaN becomes null, and a bigint fails the call.
  try {
    return JSON.parse(JSON.stringify(output)) as ToolSuccess
  } catch (error) {
    throw new Error(
      `callTool: the door cannot send the output of "${name}" as JSON, so a host gets FAILED. ${(error as Error).message}`,
      { cause: error },
    )
  }
}
