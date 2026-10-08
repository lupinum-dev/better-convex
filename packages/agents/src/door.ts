import { guarded, storable } from '@lupinum/better-convex-functions/internal'
import {
  fromJsonSchema,
  type CallToolResult,
  type jsonSchemaValidator,
} from '@modelcontextprotocol/server'
import { httpActionGeneric } from 'convex/server'

import type { McpDoorAuth, McpPrincipal } from './access'
import { handleMcpRequest } from './handler'
import { grantedTools, toolCall, toolFailure, type CatalogEntry, type ToolSuccess } from './tools'
import { maximumMcpResponseBytes } from './transport'

/** What `createMcpServer` needs from the module that calls `defineTools`. */
interface ToolsModule {
  tools: { catalog: readonly CatalogEntry[]; functions: Record<string, unknown> }
}

/**
 * The tool functions check every input against the operation's own
 * validators, so the SDK passes input through unchanged. One validator, one
 * error message.
 */
const passThrough: jsonSchemaValidator = {
  getValidator: () => (input) => ({ valid: true, data: input as never, errorMessage: undefined }),
}

const requestIdField = {
  type: ['string', 'number'],
  description: 'Optional. Send the same value when you retry this call, so it runs only once.',
}

/**
 * Runs while Convex loads the module, so `convex dev` and deploys fail on a
 * missing tool export. `internal.agents` names any function, so without this
 * a missing export would only fail on the first tool call.
 */
function assertToolsExported(agents: Partial<ToolsModule> & Record<string, unknown>) {
  if (!agents.tools)
    throw new Error('Pass the module that has `export const tools = defineTools(...)`.')
  const missing = [...agents.tools.catalog.map(({ name }) => name), 'housekeeping'].filter(
    (name) => agents[name] !== agents.tools!.functions[name],
  )
  if (missing.length > 0) {
    throw new Error(
      `Not exported from the agents module: ${missing.join(', ')}. ` +
        `Add them to \`export const { ${missing.join(', ')} } = tools.functions\`.`,
    )
  }
  return agents.tools
}

/** The text a model reads: the result as JSON, or what to tell the person for an approval. */
function resultText(output: Record<string, unknown>) {
  if (output.status === 'needs_approval') {
    return (
      `A person must approve this first: ${output.summary} ` +
      `Ask them to open ${output.url} . Then call check_approval with approvalId ${output.approvalId}.`
    )
  }
  return JSON.stringify(output)
}

/**
 * A result the transport would refuse (HTTP 502) after the write committed. The text and
 * `structuredContent` both carry it, so both count; the client gets the marker a replay gets.
 */
function bounded(output: ToolSuccess): { output: ToolSuccess; text: string } {
  const text = resultText(output)
  const bytes = 2 * new TextEncoder().encode(text).byteLength
  if (output.status !== 'done' || bytes <= maximumMcpResponseBytes - 16 * 1024)
    return { output, text }
  // `bytes` is the result's own size, as in a replay.
  const marker: ToolSuccess = { status: 'done', result: storable(output.result, 0) }
  return { output: marker, text: resultText(marker) }
}

function failure(reason: { code: string; message: string }): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: reason.message }],
    structuredContent: { error: reason },
  }
}

/**
 * The MCP door: one HTTP action for `/mcp` and its OAuth discovery route.
 * Every tool runs as its own internal Convex function, so the dashboard, logs
 * and usage name the tool, not a dispatcher. A connection sees only the tools
 * its grant's scopes unlock. `handleMcpRequest` checks the bearer token and
 * bounds the request before any tool runs.
 */
export type { McpDoorAuth, McpPrincipal } from './access'

export function createMcpServer(
  auth: McpDoorAuth,
  options: {
    /** The server name hosts show. */
    name: string
    /**
     * The module that calls `defineTools` (as `export const tools`) and exports
     * one function per tool: `import * as agents from './agents'`.
     */
    agents: ToolsModule & Record<string, unknown>
  },
) {
  const tools = assertToolsExported(options.agents)
  return guarded(
    httpActionGeneric(async (ctx, request) => {
      const { resource, authorization } = auth.mcpAuthorization(ctx)
      return handleMcpRequest<McpPrincipal>(request, {
        serverInfo: { name: options.name, version: '0.0.0' },
        resource,
        authorization,
        configureServer: ({ principal, server }) => {
          for (const entry of grantedTools(tools.catalog, principal)) {
            const write = entry.kind === 'mutation'
            const properties = { ...(entry.inputSchema.properties as object) }
            const schema = write
              ? { ...entry.inputSchema, properties: { ...properties, request_id: requestIdField } }
              : entry.inputSchema
            const note =
              entry.approval === 'always'
                ? ' A person must approve this; the result gives them a link.'
                : entry.approval === 'maybe'
                  ? ' Depending on the input, a person may need to approve this; the result then gives them a link.'
                  : ''
            server.registerTool(
              entry.name,
              {
                description: entry.description + note,
                inputSchema: fromJsonSchema<Record<string, unknown>>(schema as never, passThrough),
                // Any write may overwrite or delete; an approval rule says nothing about that.
                annotations: write
                  ? { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
                  : { readOnlyHint: true, openWorldHint: false },
              },
              async (args: Record<string, unknown>) => {
                try {
                  const { output, text } = bounded(await toolCall(entry, args, principal, ctx))
                  return { content: [{ type: 'text', text }], structuredContent: output }
                } catch (error) {
                  return failure(toolFailure(error))
                }
              },
            )
          }
        },
      })
    }),
  )
}
