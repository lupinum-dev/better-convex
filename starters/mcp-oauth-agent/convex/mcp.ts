import { handleMcpRequest, runMcpTool, type McpAccessContext } from '@lupinum/better-convex-mcp'
import {
  createBetterAuthMcpAccessVerifier,
  requireAuthOrigin,
} from '@lupinum/better-convex-nuxt/convex-auth'
import type { McpServer } from '@modelcontextprotocol/server'
import { ConvexError } from 'convex/values'
import { z } from 'zod'

import { internal } from './_generated/api'
import { httpAction, type ActionCtx } from './_generated/server'
import { authComponent } from './auth'
import { serializePrincipal, type SerializableOAuthPrincipal } from './mcp/policy'
import { MCP_SCOPES, isMcpScope, type McpScope } from './mcp/scopes'

const SAFE_APPLICATION_CODES = new Set([
  'MCP_ACCESS_REVOKED',
  'MCP_APPROVAL_REQUIRED',
  'MCP_INPUT_INVALID',
  'MCP_RATE_LIMITED',
  'MCP_RESOURCE_NOT_FOUND',
  'MCP_SCOPE_REQUIRED',
])
const idSchema = z.string().min(1).max(128)

function applicationFailure(error: unknown) {
  const code =
    error instanceof ConvexError &&
    typeof error.data === 'string' &&
    SAFE_APPLICATION_CODES.has(error.data)
      ? error.data
      : undefined
  if (!code) throw error
  return {
    content: [{ text: JSON.stringify({ code }), type: 'text' as const }],
    isError: true,
  }
}

async function invokeTool(operation: () => Promise<unknown>) {
  return await runMcpTool(async () => {
    try {
      const value = await operation()
      return {
        content: [{ text: JSON.stringify(value), type: 'text' as const }],
        structuredContent: value as Record<string, unknown>,
      }
    } catch (error) {
      return applicationFailure(error)
    }
  })
}

function requireScope(access: McpAccessContext, scope: McpScope) {
  if (access.scopes.includes(scope)) return undefined
  return {
    content: [
      {
        text: JSON.stringify({ code: 'MCP_SCOPE_REQUIRED' }),
        type: 'text' as const,
      },
    ],
    isError: true,
  }
}

export function createDelegatedMcpServer(
  ctx: ActionCtx,
  access: McpAccessContext,
  principal: SerializableOAuthPrincipal,
  server: McpServer,
) {
  server.registerTool(
    'projects.list',
    {
      description: 'List up to 100 active projects in an organization.',
      inputSchema: z.object({ organizationId: idSchema }).strict(),
    },
    async ({ organizationId }) => {
      const denied = requireScope(access, 'mcp:read')
      if (denied) return denied
      return await invokeTool(() =>
        ctx.runMutation(internal.mcpTools.listProjects, {
          organizationId,
          principal,
        }),
      )
    },
  )

  server.registerTool(
    'projects.create',
    {
      description: 'Create one project after live member authorization.',
      inputSchema: z
        .object({
          name: z.string().trim().min(1).max(100),
          organizationId: idSchema,
        })
        .strict(),
    },
    async ({ name, organizationId }) => {
      const denied = requireScope(access, 'mcp:write')
      if (denied) return denied
      return await invokeTool(() =>
        ctx.runMutation(internal.mcpTools.createProject, {
          name,
          organizationId,
          principal,
        }),
      )
    },
  )

  const projectInput = z.object({ organizationId: idSchema, projectId: idSchema }).strict()
  server.registerTool(
    'projects.delete.preview',
    {
      description: 'Preview a reversible project deletion without changing state.',
      inputSchema: projectInput,
    },
    async ({ organizationId, projectId }) => {
      const denied = requireScope(access, 'mcp:write')
      if (denied) return denied
      return await invokeTool(() =>
        ctx.runMutation(internal.mcpTools.previewProjectDelete, {
          organizationId,
          principal,
          projectId,
        }),
      )
    },
  )

  server.registerTool(
    'projects.delete.requestApproval',
    {
      description: 'Request a short-lived human approval for one project deletion.',
      inputSchema: projectInput,
    },
    async ({ organizationId, projectId }) => {
      const denied = requireScope(access, 'mcp:write')
      if (denied) return denied
      return await invokeTool(() =>
        ctx.runMutation(internal.mcpTools.requestProjectDeleteApproval, {
          organizationId,
          principal,
          projectId,
        }),
      )
    },
  )

  server.registerTool(
    'projects.delete.execute',
    {
      description: 'Soft-delete one project using its bound, approved request.',
      inputSchema: z
        .object({
          approvalId: idSchema,
          organizationId: idSchema,
          projectId: idSchema,
        })
        .strict(),
    },
    async ({ approvalId, organizationId, projectId }) => {
      const denied = requireScope(access, 'mcp:write')
      if (denied) return denied
      return await invokeTool(() =>
        ctx.runMutation(internal.mcpTools.executeProjectDelete, {
          approvalId,
          organizationId,
          principal,
          projectId,
        }),
      )
    },
  )
}

export const handleMcp = httpAction(async (ctx, request) => {
  const issuer = `${requireAuthOrigin('SITE_URL')}/api/auth`
  const resource = new URL('/mcp', requireAuthOrigin('CONVEX_SITE_URL'))
  type ProviderAccess = Parameters<
    Parameters<typeof createBetterAuthMcpAccessVerifier>[0]['validateLiveAccess']
  >[0]
  let verifiedPrincipal: ProviderAccess | undefined
  const verifier = createBetterAuthMcpAccessVerifier({
    allowedScopes: MCP_SCOPES,
    jwksUrl: `${issuer}/jwks`,
    maxLifetimeSeconds: 600,
    validateLiveAccess: async (access) => {
      if (!(await authComponent.validateOAuthAccess(ctx, access))) return false
      verifiedPrincipal = access
      return true
    },
  })
  return await handleMcpRequest(request, {
    serverInfo: {
      name: 'better-convex-nuxt-mcp-oauth-agent',
      version: '0.1.0',
    },
    resource,
    authorization: {
      issuer,
      mode: 'oauth',
      resourceName: 'Better Convex Nuxt MCP',
      scopesSupported: MCP_SCOPES,
      verifier,
    },
    configureServer(access, server) {
      const principal = verifiedPrincipal
      const delegatedScopes = principal?.scopes.filter(isMcpScope) ?? []
      if (
        !principal ||
        principal.clientId !== access.clientId ||
        principal.issuer !== access.issuer ||
        principal.resource !== access.resource ||
        principal.subject !== access.subject ||
        delegatedScopes.length !== principal.scopes.length ||
        principal.scopes.length !== access.scopes.length ||
        access.scopes.some((scope) => !principal.scopes.includes(scope))
      ) {
        throw new Error('MCP_ACCESS_CONTEXT_INVALID')
      }
      createDelegatedMcpServer(
        ctx,
        access,
        serializePrincipal({
          clientId: principal.clientId,
          issuer: principal.issuer,
          resource: principal.resource,
          scopes: new Set(delegatedScopes),
          sessionId: principal.sessionId,
          subject: principal.subject,
        }),
        server,
      )
    },
  })
})
