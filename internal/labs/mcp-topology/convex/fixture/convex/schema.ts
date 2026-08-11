import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  mcpGrants: defineTable({
    active: v.boolean(),
    clientId: v.string(),
    issuer: v.string(),
    resource: v.string(),
    subject: v.string(),
  }).index('by_binding', ['issuer', 'subject', 'clientId', 'resource']),

  members: defineTable({
    role: v.union(v.literal('editor'), v.literal('owner')),
    status: v.union(v.literal('active'), v.literal('removed')),
    subject: v.string(),
    tenantId: v.string(),
  }).index('by_subject_tenant', ['subject', 'tenantId']),

  notes: defineTable({
    body: v.string(),
    deletedAt: v.optional(v.number()),
    externalId: v.string(),
    revision: v.number(),
    title: v.string(),
    workspaceExternalId: v.string(),
  })
    .index('by_external_id', ['externalId'])
    .index('by_workspace', ['workspaceExternalId']),

  renameReceipts: defineTable({
    changed: v.boolean(),
    noteId: v.string(),
    previousTitle: v.string(),
    requestKey: v.string(),
    revision: v.number(),
    subject: v.string(),
    tenantId: v.string(),
    title: v.string(),
  }).index('by_tenant_request', ['tenantId', 'requestKey']),

  workspaces: defineTable({
    deletedAt: v.optional(v.number()),
    externalId: v.string(),
    name: v.string(),
    revision: v.number(),
    tenantId: v.string(),
  }).index('by_external_id', ['externalId']),

  workspaceDeletionInteractions: defineTable({
    clientId: v.string(),
    createdAt: v.number(),
    deletedAt: v.optional(v.number()),
    deletedNoteCount: v.optional(v.number()),
    expiresAt: v.number(),
    impactNoteIds: v.array(v.string()),
    issuer: v.string(),
    locator: v.string(),
    operationKey: v.string(),
    resource: v.string(),
    resultRevision: v.optional(v.number()),
    status: v.union(
      v.literal('pending'),
      v.literal('applied'),
      v.literal('stale'),
      v.literal('expired'),
    ),
    subject: v.string(),
    tenantId: v.string(),
    workspaceExternalId: v.string(),
    workspaceRevision: v.number(),
  })
    .index('by_locator', ['locator'])
    .index('by_operation_key', ['operationKey']),
})
