import {
  createConvexMcpHandler,
  runMcpTool,
  type McpAccessContext,
  type McpAccessVerifier,
} from '@better-convex/mcp'
import {
  CLIENT_CAPABILITIES_META_KEY,
  inputRequired,
  ResourceTemplate,
  type CallToolResult,
  type InputRequiredResult,
  type McpServer,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { z } from 'zod'

import { internal } from './_generated/api'
import { httpAction, type ActionCtx } from './_generated/server'
import { interactionUrl } from './interaction_page_contract'
import { NOTES_DASHBOARD_HTML } from './notes_dashboard'
import { createLabOAuthVerifier, labOAuthMetadataOptions, labOAuthSubject } from './oauth_fixture'

const BEARER_BOUNDARY_HEADER = 'x-bcn-lab-bearer-boundary'
const NOTES_DASHBOARD_RESOURCE_URI = 'ui://notes/dashboard.html'
const NOTES_DASHBOARD_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'
const NOTES_DASHBOARD_MAX_HTML_BYTES = 288 * 1024
if (
  !NOTES_DASHBOARD_HTML.startsWith('<!doctype html>') ||
  new TextEncoder().encode(NOTES_DASHBOARD_HTML).byteLength > NOTES_DASHBOARD_MAX_HTML_BYTES
) {
  throw new Error('MCP_APP_BUILD_INVALID')
}

const notesDashboardResourceMeta = Object.freeze({
  ui: Object.freeze({
    csp: Object.freeze({
      baseUriDomains: Object.freeze([]),
      connectDomains: Object.freeze([]),
      frameDomains: Object.freeze([]),
      resourceDomains: Object.freeze([]),
    }),
    permissions: Object.freeze({}),
    prefersBorder: true,
  }),
})

const noteSchema = z.object({
  body: z.string(),
  id: z.string(),
  revision: z.number().int().positive(),
  title: z.string(),
  uri: z.string(),
  workspaceId: z.string(),
})

const renameReceiptSchema = z.object({
  changed: z.boolean(),
  noteId: z.string(),
  previousTitle: z.string(),
  requestKey: z.string(),
  revision: z.number().int().positive(),
  title: z.string(),
})

const reportSchema = z.object({
  generatedAt: z.number().int(),
  noteCount: z.number().int().nonnegative(),
  reportId: z.string(),
  titles: z.array(z.string()),
  workspaceId: z.string(),
  workspaceRevision: z.number().int().positive(),
})

const deletedWorkspaceSchema = z.object({
  deletedAt: z.number().int(),
  deletedNoteCount: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  workspaceId: z.string(),
})

const workspaceDeletionCompleteSchema = z.discriminatedUnion('status', [
  z.object({
    receipt: deletedWorkspaceSchema,
    status: z.literal('applied'),
  }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('stale') }),
  z.object({
    code: z.literal('CLIENT_INTERACTION_UNSUPPORTED'),
    status: z.literal('interaction_unsupported'),
  }),
])

interface LabPrincipal {
  readonly subject: string
}

type OperationResult<Value> =
  | { readonly code: string; readonly ok: false }
  | { readonly ok: true; readonly value: Value }

function projectToolResult<Value>(result: OperationResult<Value>, text: (value: Value) => string) {
  if (!result.ok) {
    return {
      content: [{ text: JSON.stringify({ code: result.code }), type: 'text' as const }],
      isError: true,
    }
  }
  return {
    content: [{ text: text(result.value), type: 'text' as const }],
    structuredContent: result.value,
  }
}

interface WorkspaceDeletionState {
  readonly locator?: string
  readonly operationKey: string
  readonly receipt?: z.infer<typeof deletedWorkspaceSchema>
  readonly status: 'pending' | 'applied' | 'stale' | 'expired'
  readonly workspaceId: string
}

function supportsUrlInteraction(context: ServerContext): boolean {
  const envelope = context.mcpReq.envelope
  if (!isPlainObject(envelope)) return false
  const capabilities = Reflect.get(envelope, CLIENT_CAPABILITIES_META_KEY)
  if (!isPlainObject(capabilities)) return false
  const elicitation = Reflect.get(capabilities, 'elicitation')
  return isPlainObject(elicitation) && isPlainObject(Reflect.get(elicitation, 'url'))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function workspaceDeletionReviewUrl(locator: string): string {
  return interactionUrl(locator)
}

function projectWorkspaceDeletionComplete(
  value:
    | WorkspaceDeletionState
    | {
        readonly code: 'CLIENT_INTERACTION_UNSUPPORTED'
        readonly status: 'interaction_unsupported'
      },
): CallToolResult {
  if (value.status === 'interaction_unsupported') {
    return {
      content: [
        {
          text: 'This client cannot open the required application review.',
          type: 'text',
        },
      ],
      structuredContent: value,
    }
  }
  if (value.status === 'applied') {
    if (!value.receipt) throw new Error('MCP_WORKSPACE_DELETION_RECEIPT_INVALID')
    return {
      content: [
        {
          text: `Deleted workspace ${value.receipt.workspaceId}.`,
          type: 'text',
        },
      ],
      structuredContent: { receipt: value.receipt, status: value.status },
    }
  }
  return {
    content: [
      {
        text:
          value.status === 'pending'
            ? 'Workspace deletion is waiting for application review.'
            : `Workspace deletion is ${value.status}.`,
        type: 'text',
      },
    ],
    structuredContent: { status: value.status },
  }
}

function projectWorkspaceDeletionInput(
  value: WorkspaceDeletionState,
): InputRequiredResult | CallToolResult {
  if (value.status !== 'pending') return projectWorkspaceDeletionComplete(value)
  if (!value.locator) throw new Error('MCP_WORKSPACE_DELETION_LOCATOR_INVALID')
  return inputRequired({
    inputRequests: {
      review: inputRequired.elicitUrl({
        message: 'Review this workspace deletion in the application.',
        url: workspaceDeletionReviewUrl(value.locator),
      }),
    },
    requestState: value.operationKey,
  })
}

function applicationAccessBinding(access: McpAccessContext) {
  return {
    clientId: access.clientId,
    issuer: access.issuer,
    resource: access.resource,
    subject: access.subject,
  }
}

function createNotesServer(
  ctx: ActionCtx,
  principal: LabPrincipal,
  access: McpAccessContext,
  server: McpServer,
): void {
  server.registerTool(
    'search_notes',
    {
      description: 'Search notes visible to the current application actor.',
      inputSchema: z
        .object({
          limit: z.number().int().min(1).max(50).optional(),
          query: z.string().max(200),
          workspaceId: z.string(),
        })
        .strict(),
      outputSchema: z.object({ matches: z.array(noteSchema) }),
      _meta: {
        ui: {
          resourceUri: NOTES_DASHBOARD_RESOURCE_URI,
          visibility: ['model', 'app'],
        },
      },
    },
    async (input) =>
      runMcpTool(async () => {
        const result = await ctx.runQuery(internal.operations.searchNotes, {
          ...input,
          principal,
        })
        return projectToolResult(
          result,
          (value) =>
            `${value.matches.length} note${value.matches.length === 1 ? '' : 's'} matched.`,
        )
      }),
  )

  server.registerTool(
    'rename_note',
    {
      description: 'Rename one note with an application-owned idempotency key.',
      inputSchema: z
        .object({
          noteId: z.string(),
          requestKey: z.string(),
          title: z.string(),
        })
        .strict(),
      outputSchema: renameReceiptSchema,
    },
    async (input) =>
      runMcpTool(async () => {
        if (!access.scopes.includes('notes:write')) {
          return projectToolResult({ code: 'ACCESS_DENIED', ok: false }, () => '')
        }
        const result = await ctx.runMutation(internal.operations.renameNote, {
          ...input,
          principal,
        })
        return projectToolResult(result, (value) => `Renamed ${value.noteId}.`)
      }),
  )

  server.registerTool(
    'delete_workspace',
    {
      description:
        'Request deletion of one workspace through an application-owned high-impact review.',
      inputSchema: z
        .object({
          operationKey: z
            .string()
            .min(32)
            .max(128)
            .regex(/^[\w-]+$/),
          workspaceId: z.string(),
        })
        .strict(),
      outputSchema: workspaceDeletionCompleteSchema,
    },
    async (input, context) =>
      runMcpTool<CallToolResult | InputRequiredResult>(async () => {
        if (!access.scopes.includes('notes:write')) {
          return projectToolResult({ code: 'ACCESS_DENIED', ok: false }, () => '')
        }
        if (!supportsUrlInteraction(context)) {
          return projectWorkspaceDeletionComplete({
            code: 'CLIENT_INTERACTION_UNSUPPORTED',
            status: 'interaction_unsupported',
          })
        }
        const echoedState = context.mcpReq.requestState<string>()
        if (echoedState !== undefined && echoedState !== input.operationKey) {
          return projectToolResult({ code: 'INPUT_INVALID', ok: false }, () => '')
        }
        const result =
          echoedState === undefined
            ? await ctx.runMutation(internal.operations.prepareWorkspaceDeletion, {
                access: applicationAccessBinding(access),
                locator: crypto.randomUUID(),
                operationKey: input.operationKey,
                workspaceId: input.workspaceId,
              })
            : await ctx.runQuery(internal.operations.getWorkspaceDeletionStatus, {
                access: applicationAccessBinding(access),
                operationKey: input.operationKey,
              })
        if (!result.ok) return projectToolResult(result, () => '')
        if (result.value.workspaceId !== input.workspaceId) {
          return projectToolResult({ code: 'INPUT_INVALID', ok: false }, () => '')
        }
        if (
          echoedState !== undefined &&
          context.mcpReq.inputResponses !== undefined &&
          result.value.status === 'pending'
        ) {
          return projectWorkspaceDeletionComplete(result.value)
        }
        return projectWorkspaceDeletionInput(result.value)
      }),
  )

  server.registerTool(
    'get_workspace_deletion_status',
    {
      description: 'Read one explicit application-owned workspace deletion operation.',
      inputSchema: z
        .object({
          operationKey: z
            .string()
            .min(32)
            .max(128)
            .regex(/^[\w-]+$/),
        })
        .strict(),
      outputSchema: workspaceDeletionCompleteSchema,
    },
    async (input) =>
      runMcpTool(async () => {
        const result = await ctx.runQuery(internal.operations.getWorkspaceDeletionStatus, {
          access: applicationAccessBinding(access),
          operationKey: input.operationKey,
        })
        if (!result.ok) return projectToolResult(result, () => '')
        return projectWorkspaceDeletionComplete(result.value)
      }),
  )

  server.registerTool(
    'generate_report',
    {
      description: 'Generate a bounded report from current application state.',
      inputSchema: z.object({ workspaceId: z.string() }).strict(),
      outputSchema: reportSchema,
    },
    async (input) =>
      runMcpTool(async () => {
        const result = await ctx.runQuery(internal.operations.generateReport, {
          ...input,
          principal,
        })
        return projectToolResult(result, (value) => `Generated report ${value.reportId}.`)
      }),
  )

  server.registerResource(
    'note',
    new ResourceTemplate('note://{id}', { list: undefined }),
    { description: 'Read one note visible to the current application actor.' },
    async (uri) => {
      const result = await ctx.runQuery(internal.operations.readNoteResource, {
        principal,
        uri: uri.href,
      })
      if (!result.ok) throw new Error('MCP_RESOURCE_UNAVAILABLE')
      return { contents: [result.value] }
    },
  )

  server.registerResource(
    'notes-dashboard',
    NOTES_DASHBOARD_RESOURCE_URI,
    {
      _meta: notesDashboardResourceMeta,
      description: 'Credential-free interactive view for the neutral notes search result.',
      mimeType: NOTES_DASHBOARD_RESOURCE_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          _meta: notesDashboardResourceMeta,
          mimeType: NOTES_DASHBOARD_RESOURCE_MIME_TYPE,
          text: NOTES_DASHBOARD_HTML,
          uri: uri.href,
        },
      ],
    }),
  )
}

function createVerifier(ctx: ActionCtx, resource: URL): McpAccessVerifier {
  const verifier = createLabOAuthVerifier(resource)
  return {
    async verifyAccessToken(token, expectedResource) {
      const authInfo = await verifier.verifyAccessToken(token)
      if (authInfo.resource?.href !== expectedResource.href || authInfo.expiresAt === undefined) {
        throw new Error('MCP_ACCESS_INVALID')
      }
      const access = {
        issuer: 'https://issuer.example/api/auth',
        subject: labOAuthSubject(authInfo),
        clientId: authInfo.clientId,
        resource: authInfo.resource.href,
      }
      const active = await ctx.runQuery(internal.operations.isMcpGrantActive, {
        access,
      })
      if (!active) throw new Error('MCP_ACCESS_INVALID')
      return {
        access: {
          ...access,
          scopes: authInfo.scopes,
        },
        expiresAt: authInfo.expiresAt,
      }
    },
  }
}

function markCanonicalBearerBoundary(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set(BEARER_BOUNDARY_HEADER, 'canonical-mcp')
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

async function handleRequest(ctx: ActionCtx, request: Request): Promise<Response> {
  const resource = new URL('/mcp', request.url)
  const metadata = labOAuthMetadataOptions(resource)
  const handler = createConvexMcpHandler({
    serverInfo: {
      name: 'better-convex-convex-topology-lab',
      version: '0.0.0',
    },
    resource,
    verifier: createVerifier(ctx, resource),
    authorization: {
      mode: 'oauth',
      issuer: metadata.oauthMetadata.issuer,
      resourceName: metadata.resourceName,
      requiredScopes: ['notes:read'],
      scopesSupported: metadata.scopesSupported,
    },
    configureServer: (_context, access, server) =>
      createNotesServer(ctx, Object.freeze({ subject: access.subject }), access, server),
  })
  const response = await handler.fetch(ctx, request)
  return new URL(request.url).pathname === '/mcp' && !request.headers.has('origin')
    ? markCanonicalBearerBoundary(response)
    : response
}

export const handleMcp = httpAction(handleRequest)
export const handleOAuthMetadata = httpAction(handleRequest)
