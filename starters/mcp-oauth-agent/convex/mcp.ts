import {
  handleMcpRequest,
  registerMcpTool,
  type McpConfigureServerContext,
} from '@lupinum/better-convex-mcp'
import type { BetterConvexMcpPrincipal } from '@lupinum/better-convex-nuxt/better-auth/server'
import { z } from 'zod'

import { internal } from './_generated/api'
import { httpAction, type ActionCtx } from './_generated/server'
import { auth } from './auth'
import { PROJECT_ERROR_CODES } from './projects'

const id = z.string().min(1).max(128)
const inOrganization = z.object({ organizationId: id }).strict()
const onProject = z.object({ organizationId: id, projectId: id }).strict()
const projectSummary = z.object({ id: z.string(), name: z.string() })

/**
 * Registers the project tools for one request. Each tool passes the verified
 * principal to one internal mutation, which re-checks it before any effect.
 */
export function registerProjectTools(
  ctx: Pick<ActionCtx, 'runMutation'>,
  { principal, server, tools }: McpConfigureServerContext<BetterConvexMcpPrincipal>,
) {
  registerMcpTool(server, tools, {
    name: 'list_organizations',
    description: 'List your organizations and your role in each. Use an ID with the project tools.',
    risk: 'read',
    scopes: ['mcp:read'],
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({
      organizations: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })),
    }),
    handler: async () => ({
      structuredContent: await ctx.runMutation(internal.projects.listOrganizations, { principal }),
    }),
  })
  registerMcpTool(server, tools, {
    name: 'list_projects',
    description: 'List up to 100 active projects in an organization.',
    risk: 'read',
    scopes: ['mcp:read'],
    inputSchema: inOrganization,
    outputSchema: z.object({ projects: z.array(projectSummary) }),
    handler: async (input) => ({
      structuredContent: await ctx.runMutation(internal.projects.list, { ...input, principal }),
    }),
  })
  registerMcpTool(server, tools, {
    name: 'create_project',
    description: 'Create one project in an organization.',
    risk: 'write',
    scopes: ['mcp:write'],
    inputSchema: z.object({ organizationId: id, name: z.string().trim().min(1).max(100) }).strict(),
    outputSchema: projectSummary,
    handler: async (input) => ({
      structuredContent: await ctx.runMutation(internal.projects.create, { ...input, principal }),
    }),
  })
  registerMcpTool(server, tools, {
    name: 'request_project_deletion',
    description:
      'Ask a person to approve deleting a project. Returns the project and an approval ID for delete_project.',
    risk: 'write',
    scopes: ['mcp:write'],
    inputSchema: onProject,
    outputSchema: z.object({
      approvalId: z.string(),
      project: projectSummary,
      status: z.literal('waiting_for_approval'),
    }),
    handler: async (input) => ({
      structuredContent: await ctx.runMutation(internal.projects.requestDelete, {
        ...input,
        principal,
      }),
    }),
  })
  registerMcpTool(server, tools, {
    name: 'delete_project',
    description: 'Delete a project after a person approved the request. The app can restore it.',
    risk: 'destructive',
    scopes: ['mcp:write'],
    inputSchema: onProject.extend({ approvalId: id }).strict(),
    outputSchema: z.object({ projectId: z.string(), status: z.literal('deleted') }),
    handler: async (input) => ({
      structuredContent: await ctx.runMutation(internal.projects.remove, { ...input, principal }),
    }),
  })
}

export const handleMcp = httpAction((ctx, request) =>
  handleMcpRequest(request, {
    serverInfo: { name: 'better-convex-mcp-oauth-agent', version: '0.2.0' },
    resource: auth.mcp.resource(),
    authorization: {
      mode: 'oauth',
      issuer: auth.mcp.issuer(),
      verifier: auth.createMcpAccessVerifier(ctx),
      resourceName: 'Better Convex MCP starter',
      // Hosts that read this list request `offline_access` and receive renewal.
      scopesSupported: auth.mcp.scopesSupported(),
    },
    exposeErrorCodes: PROJECT_ERROR_CODES,
    configureServer: (context) => registerProjectTools(ctx, context),
  }),
)
