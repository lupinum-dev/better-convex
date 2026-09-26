import type {
  CallToolResult,
  ContentBlock,
  InputRequiredResult,
  McpServer,
  RegisteredTool,
  ScopeChallengeHandler,
  ServerContext,
  StandardSchemaWithJSON,
  ToolAnnotations,
  ToolCallback,
} from '@modelcontextprotocol/server'

import type { McpRequestTools } from './handler.js'

/**
 * What a tool can do to application state. It sets the MCP annotations hosts use to decide on
 * confirmation prompts: `read` never changes state, `write` adds or updates, `destructive` may
 * overwrite or delete.
 */
export type McpToolRisk = 'read' | 'write' | 'destructive'

/**
 * A tool with an `outputSchema` may return only `structuredContent`; the text content is then
 * filled with its JSON. Without an `outputSchema`, return a complete official tool result.
 */
export type McpToolHandlerResult<Output extends StandardSchemaWithJSON | undefined> =
  Output extends StandardSchemaWithJSON
    ?
        | (Omit<CallToolResult, 'content' | 'structuredContent'> & {
            content?: ContentBlock[]
            structuredContent: StandardSchemaWithJSON.InferOutput<Output>
          })
        | InputRequiredResult
    : CallToolResult | InputRequiredResult

export interface McpToolDefinition<
  Input extends StandardSchemaWithJSON,
  Output extends StandardSchemaWithJSON | undefined = undefined,
> {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly inputSchema: Input
  readonly outputSchema?: Output
  readonly risk: McpToolRisk
  /** Repeating the call with the same arguments has no additional effect. Defaults to `true` for
   * `read` tools and `false` otherwise. */
  readonly idempotent?: boolean
  /** The tool reaches systems outside this application. Defaults to `false`. */
  readonly openWorld?: boolean
  /** OAuth scopes this tool needs. Calls without them receive the SDK step-up challenge, and
   * `_meta.securitySchemes` advertises them. `tools/list` stays unfiltered. */
  readonly scopes?: readonly [string, ...string[]]
  /** MCP Apps UI template for this tool. Register the resource with `registerAppResource`. */
  readonly ui?: { readonly resourceUri: string }
  readonly _meta?: Readonly<Record<string, unknown>>
  readonly handler: (
    args: StandardSchemaWithJSON.InferOutput<Input>,
    ctx: ServerContext,
  ) => McpToolHandlerResult<Output> | Promise<McpToolHandlerResult<Output>>
}

/** Official SDK tool config. Also accepted by `registerAppTool` from `@modelcontextprotocol/ext-apps`. */
export interface McpToolConfig<
  Input extends StandardSchemaWithJSON,
  Output extends StandardSchemaWithJSON | undefined = undefined,
> {
  title?: string
  description: string
  inputSchema: Input
  outputSchema?: Output
  annotations: ToolAnnotations
  scopeChallenge?: ScopeChallengeHandler
  _meta: { [key: string]: unknown; 'ui/resourceUri'?: string }
}

/** Arguments for `server.registerTool(name, config, handler)` or `registerAppTool(server, ...)`. */
export interface DefinedMcpTool<
  Input extends StandardSchemaWithJSON,
  Output extends StandardSchemaWithJSON | undefined = undefined,
> {
  readonly name: string
  readonly config: McpToolConfig<Input, Output>
  readonly handler: ToolCallback<Input>
}

function annotationsFor(
  risk: McpToolRisk,
  options: { idempotent?: boolean; openWorld?: boolean },
): ToolAnnotations {
  if (risk !== 'read' && risk !== 'write' && risk !== 'destructive') {
    throw new TypeError('Invalid MCP tool risk')
  }
  return {
    readOnlyHint: risk === 'read',
    destructiveHint: risk === 'destructive',
    idempotentHint: options.idempotent ?? risk === 'read',
    openWorldHint: options.openWorld ?? false,
  }
}

function metaFor(
  definition: Pick<McpToolDefinition<StandardSchemaWithJSON>, '_meta' | 'scopes' | 'ui'>,
): McpToolConfig<StandardSchemaWithJSON>['_meta'] {
  const meta: McpToolConfig<StandardSchemaWithJSON>['_meta'] = { ...definition._meta }
  if (definition.scopes !== undefined) {
    meta.securitySchemes = [{ type: 'oauth2', scopes: [...definition.scopes] }]
  }
  if (definition.ui !== undefined) {
    const current = meta.ui
    meta.ui = {
      ...(current !== null && typeof current === 'object' ? current : {}),
      resourceUri: definition.ui.resourceUri,
    }
    // The legacy key `registerAppTool` also writes, so both registration paths list identically.
    meta['ui/resourceUri'] = definition.ui.resourceUri
  }
  return meta
}

function completeResult(
  result: CallToolResult | InputRequiredResult,
  structured: boolean,
): CallToolResult | InputRequiredResult {
  if (
    !structured ||
    (result as InputRequiredResult).resultType === 'input_required' ||
    (result as CallToolResult).content !== undefined
  ) {
    return result
  }
  const { structuredContent } = result as CallToolResult
  return {
    ...result,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  } as CallToolResult
}

/**
 * Builds one tool for this request: annotations from `risk`, `_meta.securitySchemes` and the SDK
 * scope step-up from `scopes`, and a handler that runs through `tools.runTool` so thrown errors are
 * projected or replaced by the static failure.
 *
 * Pass the result to `server.registerTool(tool.name, tool.config, tool.handler)` or to
 * `registerAppTool(server, tool.name, tool.config, tool.handler)` for an MCP Apps tool.
 */
export function defineMcpTool<
  Input extends StandardSchemaWithJSON,
  Output extends StandardSchemaWithJSON | undefined = undefined,
>(
  tools: McpRequestTools,
  definition: McpToolDefinition<Input, Output>,
): DefinedMcpTool<Input, Output> {
  const { name, handler } = definition
  const structured = definition.outputSchema !== undefined
  const config: McpToolConfig<Input, Output> = {
    ...(definition.title === undefined ? {} : { title: definition.title }),
    description: definition.description,
    inputSchema: definition.inputSchema,
    ...(definition.outputSchema === undefined ? {} : { outputSchema: definition.outputSchema }),
    annotations: annotationsFor(definition.risk, definition),
    ...(definition.scopes === undefined
      ? {}
      : { scopeChallenge: tools.requireScopes(...definition.scopes) }),
    _meta: metaFor(definition),
  }
  const wrapped = ((args: StandardSchemaWithJSON.InferOutput<Input>, ctx: ServerContext) =>
    tools.runTool(name, async () =>
      completeResult(
        (await handler(args, ctx)) as CallToolResult | InputRequiredResult,
        structured,
      ),
    )) as ToolCallback<Input>
  return Object.freeze({ name, config, handler: wrapped })
}

/** `defineMcpTool` followed by `server.registerTool`. */
export function registerMcpTool<
  Input extends StandardSchemaWithJSON,
  Output extends StandardSchemaWithJSON | undefined = undefined,
>(
  server: Pick<McpServer, 'registerTool'>,
  tools: McpRequestTools,
  definition: McpToolDefinition<Input, Output>,
): RegisteredTool {
  const tool = defineMcpTool(tools, definition)
  return server.registerTool(tool.name, tool.config, tool.handler)
}
