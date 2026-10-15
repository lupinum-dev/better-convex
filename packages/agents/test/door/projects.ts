import { claimUpload, fail } from '@lupinum/better-convex-functions'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'

import { mutation, query } from './fns'

const project = v.object({ id: v.id('projects'), name: v.string() })

export const create = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), name: v.string() },
  returns: project,
  tool: { name: 'create_project', description: 'Create one project.' },
  handler: async (ctx, { orgId, name }) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 100) fail('INVALID_INPUT', 'Use 1 to 100 characters.')
    const id = await ctx.db.insert('projects', { orgId, name: trimmed, status: 'active' })
    return { id, name: trimmed }
  },
})

export const archive = mutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects') },
  returns: v.object({ id: v.id('projects'), status: v.literal('archived') }),
  tool: { name: 'archive_project', description: 'Archive a project.' },
  // The same summary as convex/projects.ts.
  plan: async (ctx, { projectId }) => ({
    summary: `Archive the project "${(await ctx.db.get(projectId))?.name ?? 'unknown'}".`,
  }),
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { status: 'archived' })
    return { id: projectId, status: 'archived' as const }
  },
})

/** C4: a write whose result is too large for one response. */
export const report = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), size: v.number() },
  returns: v.string(),
  tool: { name: 'large_report', description: 'Write a report and return it.' },
  handler: async (ctx, { orgId, size }) => {
    await ctx.db.insert('projects', { orgId, name: 'report', status: 'active' })
    return 'y'.repeat(size)
  },
})

/** E9: a paginated operation, as a web query and as a tool. */
export const page = query({
  action: 'projects.search',
  args: { orgId: v.id('orgs'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(project),
  tool: { name: 'list_projects', description: 'List projects, one page at a time.' },
  handler: async (ctx, { orgId, paginationOpts }) => {
    const result = await ctx.db
      .query('projects')
      .withIndex('by_org_status', (q) => q.eq('orgId', orgId).eq('status', 'active'))
      .paginate(paginationOpts)
    return { ...result, page: result.page.map(({ _id, name }) => ({ id: _id, name })) }
  },
})

/** A result of quote-heavy text: the response escapes it twice. */
export const quotes = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), size: v.number() },
  returns: v.string(),
  tool: { name: 'quoted_report', description: 'Write a report and return it.' },
  handler: async (ctx, { orgId, size }) => {
    await ctx.db.insert('projects', { orgId, name: 'report', status: 'active' })
    return '"'.repeat(size)
  },
})

/** A result of ordinary rows, about 79 bytes of text each. */
export const rows = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), count: v.number() },
  returns: v.array(v.object({ id: v.string(), name: v.string(), status: v.string() })),
  tool: { name: 'rows_report', description: 'Write a report and return rows.' },
  handler: async (ctx, { orgId, count }) => {
    await ctx.db.insert('projects', { orgId, name: 'report', status: 'active' })
    return Array.from({ length: count }, (_, i) => ({
      id: `k57${String(i).padStart(29, '0')}`,
      name: `Project number ${i}`,
      status: 'active',
    }))
  },
})

/** A nullable file argument: a system-table ID in a union. */
export const attach = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), file: v.union(v.id('_storage'), v.null()) },
  returns: v.string(),
  tool: { name: 'attach_file', description: 'Attach a file, or none.' },
  handler: async (_ctx, { file }) => (file === null ? 'none' : 'file'),
})

/** Takes an uploaded file: a PDF or CSV of up to 1 KiB, or only a PDF. */
export const takeUpload = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), uploadId: v.string(), pdfOnly: v.optional(v.boolean()) },
  returns: v.object({ type: v.string(), size: v.number(), sha256: v.string() }),
  tool: { name: 'take_upload', description: 'Take an uploaded file.' },
  handler: async (ctx, { uploadId, pdfOnly }) => {
    const { type, size, sha256 } = await claimUpload(ctx, uploadId, {
      types: pdfOnly ? ['application/pdf'] : ['application/pdf', 'text/csv'],
      maxBytes: 1024,
    })
    return { type, size, sha256 }
  },
})

/** Takes an uploaded file in work a person approves first. */
export const takeUploadApproved = mutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects'), uploadId: v.string() },
  returns: v.string(),
  tool: { name: 'take_upload_approved', description: 'Archive a project with a file.' },
  plan: async () => ({ summary: 'Archive a project with a file.' }),
  handler: async (ctx, { projectId, uploadId }) => {
    const { type } = await claimUpload(ctx, uploadId, {
      types: ['application/pdf'],
      maxBytes: 1024,
    })
    await ctx.db.patch(projectId, { status: 'archived' })
    return type
  },
})

/** App code that claims one upload twice at once, as a tool that takes a list of IDs might. */
export const takeUploadTwice = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), uploadId: v.string(), wrongTypeFirst: v.optional(v.boolean()) },
  returns: v.number(),
  tool: {
    name: 'take_upload_twice',
    description: 'Take one upload twice at once, or first as a type it is not and then again.',
  },
  handler: async (ctx, { uploadId, wrongTypeFirst }) => {
    if (wrongTypeFirst) {
      await claimUpload(ctx, uploadId, { types: ['image/png'], maxBytes: 1024 }).catch(() => null)
      await claimUpload(ctx, uploadId, { types: ['application/pdf'], maxBytes: 1024 })
      return 1
    }
    const claims = await Promise.allSettled(
      [uploadId, uploadId].map((id) =>
        claimUpload(ctx, id, { types: ['application/pdf'], maxBytes: 1024 }),
      ),
    )
    return claims.filter((claim) => claim.status === 'fulfilled').length
  },
})

/** App code that hands `claimUpload` another actor than the call's own. */
export const takeUploadAs = mutation({
  action: 'projects.create',
  args: { orgId: v.id('orgs'), uploadId: v.string(), ownerKey: v.string() },
  returns: v.string(),
  tool: { name: 'take_upload_as', description: 'Take an upload as someone else.' },
  handler: async (ctx, { uploadId, ownerKey }) => {
    const [, userId, clientId] = ownerKey.split(':')
    const forged = { ...ctx, actor: { ...ctx.actor, user: { _id: userId }, clientId } }
    const { type } = await claimUpload(forged as never, uploadId, {
      types: ['application/pdf'],
      maxBytes: 1024,
    })
    return type
  },
})

/** Convex reports an invalid cursor as this `ConvexError`. */
export const brokenPage = query({
  action: 'projects.search',
  args: { orgId: v.id('orgs'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(project),
  tool: { name: 'list_broken', description: 'List projects; the cursor is always refused.' },
  handler: async () => {
    throw new ConvexError({ isConvexSystemError: true, paginationError: 'InvalidCursor' })
  },
})
