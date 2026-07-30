import type { McpServer } from '@modelcontextprotocol/server'
import { createConvexMcpHandler, runMcpTool, type McpAccessContext } from 'better-convex-mcp'
import { requireAuthOrigin, verifyOAuthBearerToken } from 'better-convex-nuxt/convex-auth'
import { ConvexError } from 'convex/values'
import { z } from 'zod'

import { internal } from './_generated/api'
import { httpAction, type ActionCtx } from './_generated/server'
import {
  MCP_SCOPES,
  serializePrincipal,
  type McpScope,
  type SerializableOAuthPrincipal,
} from './mcp/policy'

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
  let verifiedPrincipal: Awaited<ReturnType<typeof verifyOAuthBearerToken>> | undefined
  const handler = createConvexMcpHandler<ActionCtx>({
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
    },
    verifier: {
      async verifyAccessToken(token, expectedResource) {
        const principal = await verifyOAuthBearerToken(token, {
          allowedScopes: MCP_SCOPES,
          audience: expectedResource.href,
          issuer,
          jwksUrl: `${issuer}/jwks`,
          maxLifetimeSeconds: 600,
        })
        verifiedPrincipal = principal
        return {
          access: {
            clientId: principal.clientId,
            issuer,
            resource: expectedResource.href,
            scopes: [...principal.scopes],
            subject: principal.subject,
          },
          expiresAt: principal.expiresAt,
        }
      },
    },
    configureServer(actionCtx, access, server) {
      const principal = verifiedPrincipal
      if (
        !principal ||
        principal.clientId !== access.clientId ||
        principal.subject !== access.subject
      ) {
        throw new Error('MCP_ACCESS_CONTEXT_INVALID')
      }
      createDelegatedMcpServer(
        actionCtx,
        access,
        serializePrincipal({
          clientId: principal.clientId,
          resource: access.resource,
          scopes: new Set(principal.scopes),
          sessionId: principal.sessionId,
          subject: principal.subject,
        }),
        server,
      )
    },
  })
  return await handler.fetch(ctx, request)
})
