/* eslint-disable @typescript-eslint/no-explicit-any -- generated auth models are selected at runtime */
import type { SchemaDefinition } from 'convex/server'

import type { AuthFieldMetadata, AuthSchemaMetadata } from './metadata'
import { getAuthModelMetadata } from './metadata'
import { collectAuthRows, findAuthRows, toBetterAuthDocument } from './query'

interface PlannedAuthRow {
  key: string
  model: string
  row: Record<string, unknown>
}

interface RelationshipTriggerHandles {
  onDeleteHandle?: string
  onDeleteModels?: readonly string[]
  onUpdateHandle?: string
  onUpdateModels?: readonly string[]
}

type TriggerRunner = (
  ctx: any,
  handle: string | undefined,
  payload: Record<string, unknown>,
) => Promise<void>

const AUTH_BULK_OPERATION_LIMIT = 128

function rejectOversizedOperation(): never {
  throw new Error('AUTH_BULK_OPERATION_LIMIT_EXCEEDED')
}

function plannedRow(model: string, row: Record<string, unknown>): PlannedAuthRow {
  return { key: `${model}:${String(row._id)}`, model, row }
}

export function createAuthRelationshipEngine(input: {
  schema: SchemaDefinition<any, any>
  metadata: AuthSchemaMetadata
  runTrigger: TriggerRunner
}) {
  const { schema, metadata, runTrigger } = input
  const inboundByModel = new Map<string, Array<{ model: string; field: AuthFieldMetadata }>>()
  for (const model of Object.values(metadata.models)) {
    for (const field of Object.values(model.fields)) {
      if (!field.reference) continue
      const inbound = inboundByModel.get(field.reference.model) ?? []
      inbound.push({ model: model.physicalName, field })
      inboundByModel.set(field.reference.model, inbound)
    }
  }

  async function assertTargets(
    ctx: any,
    modelName: string,
    row: Record<string, unknown>,
    changedFields?: ReadonlySet<string>,
  ): Promise<void> {
    const model = getAuthModelMetadata(metadata, modelName)
    for (const field of Object.values(model.fields)) {
      if (!field.reference || (changedFields && !changedFields.has(field.physicalName))) continue
      const value = row[field.physicalName]
      if (value === null) continue
      const matches = await findAuthRows(
        ctx,
        schema,
        metadata,
        {
          model: field.reference.model,
          where: [{ field: field.reference.field, value: value as never }],
        },
        2,
      )
      if (matches.length === 0) {
        throw new Error(`AUTH_REFERENCE_TARGET_MISSING:${modelName}.${field.physicalName}`)
      }
      if (matches.length > 1) {
        throw new Error(`AUTH_REFERENCE_TARGET_AMBIGUOUS:${modelName}.${field.physicalName}`)
      }
    }
  }

  async function findReferencingRows(
    ctx: any,
    parent: PlannedAuthRow,
    childModel: string,
    childField: AuthFieldMetadata,
  ): Promise<Record<string, unknown>[]> {
    const parentField = childField.reference!.field
    return collectOperationRows(ctx, {
      model: childModel,
      where: [{ field: childField.physicalName, value: parent.row[parentField] as never }],
    })
  }

  async function collectOperationRows(
    ctx: any,
    args: Parameters<typeof collectAuthRows>[3],
  ): Promise<Record<string, unknown>[]> {
    try {
      return await collectAuthRows(ctx, schema, metadata, args, AUTH_BULK_OPERATION_LIMIT)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `AUTH_QUERY_LIMIT_EXCEEDED:${AUTH_BULK_OPERATION_LIMIT}`
      ) {
        rejectOversizedOperation()
      }
      throw error
    }
  }

  async function applyDeletion(
    ctx: any,
    roots: Record<string, unknown>[],
    rootModel: string,
    handles: RelationshipTriggerHandles,
  ): Promise<void> {
    const visited = new Set<string>()
    const deletionOrder: PlannedAuthRow[] = []
    const deleteTriggerModels = new Set(handles.onDeleteModels ?? [])
    const updateTriggerModels = new Set(handles.onUpdateModels ?? [])

    const collectCascade = async (candidate: PlannedAuthRow): Promise<void> => {
      if (visited.has(candidate.key)) return
      if (visited.size === AUTH_BULK_OPERATION_LIMIT) rejectOversizedOperation()
      visited.add(candidate.key)
      for (const inbound of inboundByModel.get(candidate.model) ?? []) {
        if (inbound.field.reference!.onDelete !== 'cascade') continue
        const children = await findReferencingRows(ctx, candidate, inbound.model, inbound.field)
        for (const child of children) await collectCascade(plannedRow(inbound.model, child))
      }
      deletionOrder.push(candidate)
    }

    for (const root of roots) await collectCascade(plannedRow(rootModel, root))

    const setNullPatches = new Map<
      string,
      { planned: PlannedAuthRow; patch: Record<string, null> }
    >()
    for (const candidate of deletionOrder) {
      for (const inbound of inboundByModel.get(candidate.model) ?? []) {
        const policy = inbound.field.reference!.onDelete
        if (policy === 'cascade') continue
        const children = await findReferencingRows(ctx, candidate, inbound.model, inbound.field)
        for (const child of children) {
          const planned = plannedRow(inbound.model, child)
          if (visited.has(planned.key)) continue
          if (policy === 'restrict') {
            throw new Error(
              `AUTH_REFERENCE_DELETE_RESTRICTED:${candidate.model}.${inbound.field.reference!.field}`,
            )
          }
          if (!inbound.field.nullable) {
            throw new Error(
              `AUTH_REFERENCE_SET_NULL_REQUIRED:${inbound.model}.${inbound.field.physicalName}`,
            )
          }
          const existing = setNullPatches.get(planned.key) ?? { planned, patch: {} }
          if (
            !setNullPatches.has(planned.key) &&
            visited.size + setNullPatches.size === AUTH_BULK_OPERATION_LIMIT
          ) {
            rejectOversizedOperation()
          }
          existing.patch[inbound.field.physicalName] = null
          setNullPatches.set(planned.key, existing)
        }
      }
    }

    for (const { planned, patch } of setNullPatches.values()) {
      await ctx.db.patch(planned.row._id as never, patch as never)
      if (!handles.onUpdateHandle || !updateTriggerModels.has(planned.model)) continue
      const updated = await ctx.db.get(planned.row._id as never)
      if (!updated) throw new Error('AUTH_REFERENCE_SET_NULL_READBACK_FAILED')
      await runTrigger(ctx, handles.onUpdateHandle, {
        model: planned.model,
        oldDoc: toBetterAuthDocument(planned.row),
        newDoc: toBetterAuthDocument(updated as never),
      })
    }

    for (const candidate of deletionOrder) {
      await ctx.db.delete(candidate.row._id as never)
      if (!handles.onDeleteHandle || !deleteTriggerModels.has(candidate.model)) continue
      await runTrigger(ctx, handles.onDeleteHandle, {
        model: candidate.model,
        doc: toBetterAuthDocument(candidate.row),
      })
    }
  }

  return Object.freeze({ applyDeletion, assertTargets, collectOperationRows })
}
