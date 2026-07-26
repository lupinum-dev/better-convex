import { v } from 'convex/values'

import { internalMutation, internalQuery, type QueryCtx } from './_generated/server'
import { isInteractionLocator } from './interaction_page_contract'

const MAX_ID_LENGTH = 128
const MAX_NOTE_TITLE_LENGTH = 120
const MAX_SEARCH_QUERY_LENGTH = 200
const MAX_SEARCH_RESULTS = 50
const MAX_WORKSPACE_DELETE_NOTES = 100
const WORKSPACE_DELETE_INTERACTION_TTL_MS = 10 * 60 * 1_000

const principal = v.object({ subject: v.string() })
const mcpAccessBinding = v.object({
  clientId: v.string(),
  issuer: v.string(),
  resource: v.string(),
  subject: v.string(),
})
const browserActor = v.object({
  issuer: v.string(),
  subject: v.string(),
})

type ApplicationErrorCode =
  | 'ACCESS_DENIED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INPUT_INVALID'
  | 'INTERACTION_NOT_FOUND'
  | 'NOTE_NOT_FOUND'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_TOO_LARGE'
  | 'WORKSPACE_STALE'

type ReadCtx = Pick<QueryCtx, 'db'>

function failure(code: ApplicationErrorCode) {
  return { code, ok: false as const }
}

function boundedId(value: string): string | null {
  return value && value.length <= MAX_ID_LENGTH && /^[\w-]+$/.test(value) ? value : null
}

function boundedOpaqueId(value: string): string | null {
  return isInteractionLocator(value) ? value : null
}

function boundedIdentity(value: string): string | null {
  return value && value.length <= 512 && value.trim() === value && !hasUnsafeTextCharacter(value)
    ? value
    : null
}

function hasUnsafeTextCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
}

function normalizeTitle(value: string): string | null {
  const title = value.trim().replace(/\s+/g, ' ')
  return title && title.length <= MAX_NOTE_TITLE_LENGTH ? title : null
}

async function workspaceImpact(ctx: ReadCtx, workspaceExternalId: string) {
  const notes = await ctx.db
    .query('notes')
    .withIndex('by_workspace', (query) => query.eq('workspaceExternalId', workspaceExternalId))
    .take(MAX_WORKSPACE_DELETE_NOTES + 1)
  if (notes.length > MAX_WORKSPACE_DELETE_NOTES) return failure('WORKSPACE_TOO_LARGE')
  return {
    impactNoteIds: notes
      .filter((note) => note.deletedAt === undefined)
      .map((note) => note.externalId)
      .sort(),
    notes,
    ok: true as const,
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function interactionStatus(
  interaction: {
    expiresAt: number
    status: 'pending' | 'applied' | 'stale' | 'expired'
  },
  now: number,
) {
  return interaction.status === 'pending' && interaction.expiresAt <= now
    ? ('expired' as const)
    : interaction.status
}

function interactionReview(interaction: {
  impactNoteIds: readonly string[]
  workspaceExternalId: string
}) {
  return {
    effects: [
      {
        noteCount: interaction.impactNoteIds.length,
        type: 'workspace_deleted' as const,
        workspaceId: interaction.workspaceExternalId,
      },
    ],
    summary: `Delete workspace ${interaction.workspaceExternalId}`,
    warnings:
      interaction.impactNoteIds.length === 0
        ? []
        : [
            {
              code: 'NOTES_WILL_BE_DELETED' as const,
              count: interaction.impactNoteIds.length,
            },
          ],
  }
}

function interactionReceipt(interaction: {
  deletedAt?: number
  deletedNoteCount?: number
  resultRevision?: number
  workspaceExternalId: string
}) {
  return interaction.deletedAt === undefined ||
    interaction.deletedNoteCount === undefined ||
    interaction.resultRevision === undefined
    ? undefined
    : {
        deletedAt: interaction.deletedAt,
        deletedNoteCount: interaction.deletedNoteCount,
        revision: interaction.resultRevision,
        workspaceId: interaction.workspaceExternalId,
      }
}

function sameMcpBinding(
  interaction: {
    clientId: string
    issuer: string
    resource: string
    subject: string
  },
  access: {
    clientId: string
    issuer: string
    resource: string
    subject: string
  },
): boolean {
  return (
    interaction.clientId === access.clientId &&
    interaction.issuer === access.issuer &&
    interaction.resource === access.resource &&
    interaction.subject === access.subject
  )
}

function sameBrowserActor(
  interaction: { issuer: string; subject: string },
  actor: { issuer: string; subject: string },
): boolean {
  return interaction.issuer === actor.issuer && interaction.subject === actor.subject
}

async function hasLiveMcpGrant(
  ctx: ReadCtx,
  access: {
    clientId: string
    issuer: string
    resource: string
    subject: string
  },
): Promise<boolean> {
  const grant = await ctx.db
    .query('mcpGrants')
    .withIndex('by_binding', (query) =>
      query
        .eq('issuer', access.issuer)
        .eq('subject', access.subject)
        .eq('clientId', access.clientId)
        .eq('resource', access.resource),
    )
    .unique()
  return grant?.active === true
}

export const isMcpGrantActive = internalQuery({
  args: {
    access: mcpAccessBinding,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => await hasLiveMcpGrant(ctx, args.access),
})

async function workspaceAccess(ctx: ReadCtx, subject: string, externalId: string) {
  const id = boundedId(externalId)
  if (!id) return failure('INPUT_INVALID')
  const workspace = await ctx.db
    .query('workspaces')
    .withIndex('by_external_id', (query) => query.eq('externalId', id))
    .unique()
  if (!workspace || workspace.deletedAt !== undefined) return failure('WORKSPACE_NOT_FOUND')
  const member = await ctx.db
    .query('members')
    .withIndex('by_subject_tenant', (query) =>
      query.eq('subject', subject).eq('tenantId', workspace.tenantId),
    )
    .unique()
  if (!member || member.status !== 'active') return failure('ACCESS_DENIED')
  return { member, ok: true as const, workspace }
}

async function noteAccess(ctx: ReadCtx, subject: string, externalId: string) {
  const id = boundedId(externalId)
  if (!id) return failure('INPUT_INVALID')
  const note = await ctx.db
    .query('notes')
    .withIndex('by_external_id', (query) => query.eq('externalId', id))
    .unique()
  if (!note || note.deletedAt !== undefined) return failure('NOTE_NOT_FOUND')
  const access = await workspaceAccess(ctx, subject, note.workspaceExternalId)
  if (!access.ok) return access
  return { ...access, note }
}

function noteResult(note: {
  body: string
  externalId: string
  revision: number
  title: string
  workspaceExternalId: string
}) {
  return {
    body: note.body,
    id: note.externalId,
    revision: note.revision,
    title: note.title,
    uri: `note://${note.externalId}`,
    workspaceId: note.workspaceExternalId,
  }
}

export const searchNotes = internalQuery({
  args: {
    limit: v.optional(v.number()),
    principal,
    query: v.string(),
    workspaceId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await workspaceAccess(ctx, args.principal.subject, args.workspaceId)
    if (!access.ok) return access
    const query = args.query.trim().toLocaleLowerCase('en-US')
    const limit = args.limit ?? 20
    if (
      query.length > MAX_SEARCH_QUERY_LENGTH ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_SEARCH_RESULTS
    ) {
      return failure('INPUT_INVALID')
    }
    const notes = await ctx.db
      .query('notes')
      .withIndex('by_workspace', (builder) =>
        builder.eq('workspaceExternalId', access.workspace.externalId),
      )
      .collect()
    const matches = notes
      .filter(
        (note) =>
          note.deletedAt === undefined &&
          (!query ||
            note.title.toLocaleLowerCase('en-US').includes(query) ||
            note.body.toLocaleLowerCase('en-US').includes(query)),
      )
      .sort((left, right) => left.externalId.localeCompare(right.externalId))
      .slice(0, limit)
      .map(noteResult)
    return { ok: true as const, value: { matches } }
  },
})

export const readNoteResource = internalQuery({
  args: { principal, uri: v.string() },
  handler: async (ctx, args) => {
    const match = /^note:\/\/([\w-]{1,128})$/.exec(args.uri)
    if (!match?.[1]) return failure('INPUT_INVALID')
    const access = await noteAccess(ctx, args.principal.subject, match[1])
    if (!access.ok) return access
    const value = noteResult(access.note)
    return {
      ok: true as const,
      value: {
        mimeType: 'application/json' as const,
        text: JSON.stringify(value),
        uri: value.uri,
      },
    }
  },
})

export const generateReport = internalQuery({
  args: { principal, workspaceId: v.string() },
  handler: async (ctx, args) => {
    const access = await workspaceAccess(ctx, args.principal.subject, args.workspaceId)
    if (!access.ok) return access
    const notes = await ctx.db
      .query('notes')
      .withIndex('by_workspace', (query) =>
        query.eq('workspaceExternalId', access.workspace.externalId),
      )
      .collect()
    const titles = notes
      .filter((note) => note.deletedAt === undefined)
      .sort((left, right) => left.externalId.localeCompare(right.externalId))
      .map((note) => note.title)
    return {
      ok: true as const,
      value: {
        generatedAt: Date.now(),
        noteCount: titles.length,
        reportId: `${access.workspace.externalId}-r${access.workspace.revision}`,
        titles,
        workspaceId: access.workspace.externalId,
        workspaceRevision: access.workspace.revision,
      },
    }
  },
})

export const renameNote = internalMutation({
  args: {
    noteId: v.string(),
    principal,
    requestKey: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await noteAccess(ctx, args.principal.subject, args.noteId)
    if (!access.ok) return access
    const requestKey = boundedId(args.requestKey)
    const title = normalizeTitle(args.title)
    if (!requestKey || !title) return failure('INPUT_INVALID')
    const existing = await ctx.db
      .query('renameReceipts')
      .withIndex('by_tenant_request', (query) =>
        query.eq('tenantId', access.workspace.tenantId).eq('requestKey', requestKey),
      )
      .unique()
    if (existing) {
      if (
        existing.subject !== args.principal.subject ||
        existing.noteId !== access.note.externalId ||
        existing.title !== title
      ) {
        return failure('IDEMPOTENCY_CONFLICT')
      }
      return {
        ok: true as const,
        value: {
          changed: existing.changed,
          noteId: existing.noteId,
          previousTitle: existing.previousTitle,
          requestKey: existing.requestKey,
          revision: existing.revision,
          title: existing.title,
        },
      }
    }

    const previousTitle = access.note.title
    const changed = previousTitle !== title
    const revision = changed ? access.note.revision + 1 : access.note.revision
    if (changed) await ctx.db.patch(access.note._id, { revision, title })
    await ctx.db.insert('renameReceipts', {
      changed,
      noteId: access.note.externalId,
      previousTitle,
      requestKey,
      revision,
      subject: args.principal.subject,
      tenantId: access.workspace.tenantId,
      title,
    })
    return {
      ok: true as const,
      value: {
        changed,
        noteId: access.note.externalId,
        previousTitle,
        requestKey,
        revision,
        title,
      },
    }
  },
})

export const prepareWorkspaceDeletion = internalMutation({
  args: {
    access: mcpAccessBinding,
    locator: v.string(),
    operationKey: v.string(),
    workspaceId: v.string(),
  },
  handler: async (ctx, args) => {
    const locator = boundedOpaqueId(args.locator)
    const operationKey = boundedOpaqueId(args.operationKey)
    if (
      !locator ||
      !operationKey ||
      !boundedIdentity(args.access.clientId) ||
      !boundedIdentity(args.access.issuer) ||
      !boundedIdentity(args.access.resource) ||
      !boundedIdentity(args.access.subject)
    ) {
      return failure('INPUT_INVALID')
    }
    if (!(await hasLiveMcpGrant(ctx, args.access))) return failure('ACCESS_DENIED')
    const access = await workspaceAccess(ctx, args.access.subject, args.workspaceId)
    if (!access.ok) return access
    if (access.member.role !== 'owner') return failure('ACCESS_DENIED')
    const impact = await workspaceImpact(ctx, access.workspace.externalId)
    if (!impact.ok) return impact
    const [existingOperation, existingLocator] = await Promise.all([
      ctx.db
        .query('workspaceDeletionInteractions')
        .withIndex('by_operation_key', (query) => query.eq('operationKey', operationKey))
        .unique(),
      ctx.db
        .query('workspaceDeletionInteractions')
        .withIndex('by_locator', (query) => query.eq('locator', locator))
        .unique(),
    ])
    if (existingOperation) {
      if (
        !sameMcpBinding(existingOperation, args.access) ||
        existingOperation.workspaceExternalId !== access.workspace.externalId
      ) {
        return failure('IDEMPOTENCY_CONFLICT')
      }
      return {
        ok: true as const,
        value: {
          expiresAt: existingOperation.expiresAt,
          locator: existingOperation.locator,
          operationKey,
          receipt: interactionReceipt(existingOperation),
          review: interactionReview(existingOperation),
          status: interactionStatus(existingOperation, Date.now()),
          workspaceId: existingOperation.workspaceExternalId,
        },
      }
    }
    if (existingLocator) return failure('IDEMPOTENCY_CONFLICT')

    const createdAt = Date.now()
    const interaction = {
      clientId: args.access.clientId,
      createdAt,
      expiresAt: createdAt + WORKSPACE_DELETE_INTERACTION_TTL_MS,
      impactNoteIds: impact.impactNoteIds,
      issuer: args.access.issuer,
      locator,
      operationKey,
      resource: args.access.resource,
      status: 'pending' as const,
      subject: args.access.subject,
      tenantId: access.workspace.tenantId,
      workspaceExternalId: access.workspace.externalId,
      workspaceRevision: access.workspace.revision,
    }
    await ctx.db.insert('workspaceDeletionInteractions', interaction)
    return {
      ok: true as const,
      value: {
        expiresAt: interaction.expiresAt,
        locator,
        operationKey,
        review: interactionReview(interaction),
        status: interaction.status,
        workspaceId: interaction.workspaceExternalId,
      },
    }
  },
})

export const getWorkspaceDeletionStatus = internalQuery({
  args: {
    access: mcpAccessBinding,
    operationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const operationKey = boundedOpaqueId(args.operationKey)
    if (!operationKey) return failure('INPUT_INVALID')
    if (!(await hasLiveMcpGrant(ctx, args.access))) return failure('INTERACTION_NOT_FOUND')
    const interaction = await ctx.db
      .query('workspaceDeletionInteractions')
      .withIndex('by_operation_key', (query) => query.eq('operationKey', operationKey))
      .unique()
    if (!interaction || !sameMcpBinding(interaction, args.access)) {
      return failure('INTERACTION_NOT_FOUND')
    }
    return {
      ok: true as const,
      value: {
        locator: interaction.locator,
        operationKey,
        receipt: interactionReceipt(interaction),
        review: interactionReview(interaction),
        status: interactionStatus(interaction, Date.now()),
        workspaceId: interaction.workspaceExternalId,
      },
    }
  },
})

export const getWorkspaceDeletionReview = internalQuery({
  args: {
    actor: browserActor,
    locator: v.string(),
  },
  handler: async (ctx, args) => {
    const locator = boundedOpaqueId(args.locator)
    if (!locator) return failure('INPUT_INVALID')
    const interaction = await ctx.db
      .query('workspaceDeletionInteractions')
      .withIndex('by_locator', (query) => query.eq('locator', locator))
      .unique()
    if (!interaction || !sameBrowserActor(interaction, args.actor)) {
      return failure('INTERACTION_NOT_FOUND')
    }
    if (!(await hasLiveMcpGrant(ctx, interaction))) return failure('ACCESS_DENIED')
    return {
      ok: true as const,
      value: {
        expiresAt: interaction.expiresAt,
        receipt: interactionReceipt(interaction),
        review: interactionReview(interaction),
        status: interactionStatus(interaction, Date.now()),
      },
    }
  },
})

export const confirmWorkspaceDeletion = internalMutation({
  args: {
    actor: browserActor,
    locator: v.string(),
  },
  handler: async (ctx, args) => {
    const locator = boundedOpaqueId(args.locator)
    if (!locator) return failure('INPUT_INVALID')
    const interaction = await ctx.db
      .query('workspaceDeletionInteractions')
      .withIndex('by_locator', (query) => query.eq('locator', locator))
      .unique()
    if (!interaction || !sameBrowserActor(interaction, args.actor)) {
      return failure('INTERACTION_NOT_FOUND')
    }
    if (!(await hasLiveMcpGrant(ctx, interaction))) return failure('ACCESS_DENIED')
    if (interaction.status === 'applied') {
      const receipt = interactionReceipt(interaction)
      if (!receipt) throw new Error('LAB_INTERACTION_RECEIPT_INVALID')
      return {
        ok: true as const,
        value: { receipt, status: 'applied' as const },
      }
    }
    if (interaction.status !== 'pending') {
      return { ok: true as const, value: { status: interaction.status } }
    }

    const now = Date.now()
    if (interaction.expiresAt <= now) {
      await ctx.db.patch(interaction._id, { status: 'expired' })
      return { ok: true as const, value: { status: 'expired' as const } }
    }
    const access = await workspaceAccess(ctx, interaction.subject, interaction.workspaceExternalId)
    if (!access.ok) return access
    if (access.member.role !== 'owner') return failure('ACCESS_DENIED')
    const impact = await workspaceImpact(ctx, access.workspace.externalId)
    if (!impact.ok) return impact
    if (
      access.workspace.revision !== interaction.workspaceRevision ||
      !sameStringArray(impact.impactNoteIds, interaction.impactNoteIds)
    ) {
      await ctx.db.patch(interaction._id, { status: 'stale' })
      return { ok: true as const, value: { status: 'stale' as const } }
    }

    let deletedNoteCount = 0
    for (const note of impact.notes) {
      if (note.deletedAt !== undefined) continue
      await ctx.db.patch(note._id, { deletedAt: now })
      deletedNoteCount += 1
    }
    const resultRevision = access.workspace.revision + 1
    await ctx.db.patch(access.workspace._id, {
      deletedAt: now,
      revision: resultRevision,
    })
    await ctx.db.patch(interaction._id, {
      deletedAt: now,
      deletedNoteCount,
      resultRevision,
      status: 'applied',
    })
    return {
      ok: true as const,
      value: {
        receipt: {
          deletedAt: now,
          deletedNoteCount,
          revision: resultRevision,
          workspaceId: interaction.workspaceExternalId,
        },
        status: 'applied' as const,
      },
    }
  },
})
