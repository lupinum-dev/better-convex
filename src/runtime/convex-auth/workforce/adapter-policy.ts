import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server'

import type { AuthSchemaMetadata } from '../adapter/metadata'
import {
  assertSessionGenerationUpdate,
  currentSessionOrNull,
  invalidateSessionCollection,
  prepareSessionGenerationCreate,
  sessionGenerationAuthority,
} from '../session-generation'
import {
  advanceWorkforceGeneration,
  invalidateWorkforcePasswordChange,
} from './credential-generation'
import { prepareWorkforceFactorWrite, type RecoveryConsumption } from './factor-transitions'
import type { WorkforceConsumedChallenge, WorkforceOperation } from './operations'
import { readWorkforcePendingFactor } from './pending-factor-view'
import { assertGenericVerificationDelete, collectExpiredWorkforceVerificationRows } from './replay'
import {
  prepareWorkforceProofUpdate,
  prepareWorkforceSessionCreate,
  prepareWorkforceVerificationCreate,
} from './session-transitions'

type MutationCtx = GenericMutationCtx<GenericDataModel>
type QueryCtx = GenericQueryCtx<GenericDataModel>
type Row = Record<string, unknown>

/** The only component-side integration point for workforce persistence policy. */
export function createWorkforceAdapterPolicy(enabled: boolean, metadata: AuthSchemaMetadata) {
  const generationAuthority = sessionGenerationAuthority(metadata)
  function assertEvidence(
    operation?: WorkforceOperation,
    consumedChallenge?: WorkforceConsumedChallenge,
  ) {
    if (!enabled && (operation || consumedChallenge)) {
      throw new Error('AUTH_WORKFORCE_SCHEMA_REQUIRED')
    }
  }

  return {
    enabled,

    async scheduleCreatedSession(
      model: string,
      row: Row,
      schedule: (expiresAt: number) => Promise<void>,
    ) {
      if (!generationAuthority || model !== generationAuthority.sessionModel) return
      if (typeof row.expiresAt !== 'number') throw new Error('AUTH_SESSION_INVALID')
      await schedule(row.expiresAt)
    },

    assertDeleteCandidate(candidate: { model: string; row: Row }) {
      if (enabled && candidate.model === 'verification') {
        assertGenericVerificationDelete(candidate.row)
      }
    },

    async beforeDeletion(ctx: MutationCtx, deletionOrder: Array<{ model: string; row: Row }>) {
      if (!enabled) return
      const deletedUsers = new Set(
        deletionOrder
          .filter((candidate) => candidate.model === 'user')
          .map((candidate) => candidate.row.id),
      )
      const affectedUsers = new Set(
        deletionOrder
          .filter(
            (candidate) =>
              candidate.model === 'account' && candidate.row.providerId === 'credential',
          )
          .map((candidate) => candidate.row.userId),
      )
      if (
        deletionOrder.some(
          (candidate) => candidate.model === 'twoFactor' && !deletedUsers.has(candidate.row.userId),
        )
      ) {
        throw new Error('AUTH_WORKFORCE_FACTOR_DELETE_FORBIDDEN')
      }
      for (const userId of affectedUsers) {
        if (!deletedUsers.has(userId)) await advanceWorkforceGeneration(ctx, userId)
      }
    },

    async prepareCreate(
      ctx: MutationCtx,
      model: string,
      row: Row,
      operation?: WorkforceOperation,
      consumedChallenge?: WorkforceConsumedChallenge,
    ): Promise<Row> {
      assertEvidence(operation, consumedChallenge)
      if (!enabled) return row
      if (consumedChallenge && model !== 'session') {
        throw new Error('AUTH_WORKFORCE_UNEXPECTED_CHALLENGE_RECEIPT')
      }
      await invalidateWorkforcePasswordChange(ctx, model, null, row, operation)
      let prepared = row
      prepared = await prepareWorkforceFactorWrite(ctx, model, null, prepared, operation)
      if (model === 'session') {
        return prepareWorkforceSessionCreate(ctx, prepared, operation, consumedChallenge)
      }
      if (model === 'verification') {
        return prepareWorkforceVerificationCreate(ctx, prepared, operation)
      }
      return prepared
    },

    async projectFind(
      ctx: QueryCtx,
      model: string,
      row: Row | null,
      operation?: WorkforceOperation,
    ) {
      assertEvidence(operation)
      if (generationAuthority && model === generationAuthority.sessionModel) {
        return currentSessionOrNull(ctx, row, generationAuthority)
      }
      return enabled && model === 'twoFactor'
        ? readWorkforcePendingFactor(ctx, row, operation)
        : row
    },

    prepareCreateInput(ctx: QueryCtx, model: string, data: unknown) {
      if (!generationAuthority) return data
      return prepareSessionGenerationCreate(ctx, model, data, generationAuthority)
    },

    prepareReadSelect(model: string, select: readonly string[] | undefined) {
      if (
        !generationAuthority ||
        model !== generationAuthority.sessionModel ||
        select === undefined
      ) {
        return select
      }
      return [
        ...new Set([
          ...select,
          generationAuthority.userIdField,
          generationAuthority.assuranceGenerationField,
        ]),
      ]
    },

    invalidateSessionCollection(
      ctx: MutationCtx,
      model: string,
      where: RecoveryConsumption['where'],
    ) {
      if (!generationAuthority) return null
      return invalidateSessionCollection(ctx, model, where, generationAuthority)
    },

    async prepareUpdate(
      ctx: MutationCtx,
      model: string,
      current: Row,
      patch: Row,
      operation?: WorkforceOperation,
      consumption?: RecoveryConsumption,
    ) {
      assertEvidence(operation)
      if (!enabled) {
        if (generationAuthority) assertSessionGenerationUpdate(model, patch, generationAuthority)
        return patch
      }
      const guarded = prepareWorkforceProofUpdate(model, current, patch)
      await invalidateWorkforcePasswordChange(
        ctx,
        model,
        current,
        { ...current, ...guarded },
        operation,
      )
      return prepareWorkforceFactorWrite(ctx, model, current, guarded, operation, consumption)
    },

    async prepareBulkUpdate(ctx: MutationCtx, model: string, current: Row, patch: Row) {
      if (!enabled) {
        if (generationAuthority) assertSessionGenerationUpdate(model, patch, generationAuthority)
        return patch
      }
      const guarded = prepareWorkforceProofUpdate(model, current, patch)
      await invalidateWorkforcePasswordChange(ctx, model, current, { ...current, ...guarded })
      return prepareWorkforceFactorWrite(ctx, model, current, guarded, undefined)
    },

    async expiredVerificationRows(
      ctx: MutationCtx,
      model: string,
      where: RecoveryConsumption['where'],
    ): Promise<Row[] | null> {
      const cutoff = where[0]
      if (
        !enabled ||
        model !== 'verification' ||
        where.length !== 1 ||
        cutoff?.field !== 'expiresAt' ||
        cutoff.operator !== 'lt' ||
        typeof cutoff.value !== 'number' ||
        cutoff.connector === 'OR' ||
        cutoff.mode === 'insensitive'
      ) {
        return null
      }
      return collectExpiredWorkforceVerificationRows(ctx, cutoff.value)
    },
  }
}
