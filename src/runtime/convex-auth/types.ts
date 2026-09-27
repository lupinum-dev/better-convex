import type { betterAuth } from 'better-auth'
import type { FunctionReference, GenericDataModel, GenericMutationCtx } from 'convex/server'

import type { ComponentApi } from './component/_generated/component'
import type { AuthCtx } from './context'

export type AuthFunctions = {
  onCreate?: FunctionReference<'mutation', 'internal'>
  onUpdate?: FunctionReference<'mutation', 'internal'>
  onDelete?: FunctionReference<'mutation', 'internal'>
}

type AuthTriggerDocument = Record<string, unknown>

export type AuthComponentTriggers<DataModel extends GenericDataModel = GenericDataModel> = Partial<
  Record<
    string,
    {
      onCreate?: (ctx: GenericMutationCtx<DataModel>, doc: AuthTriggerDocument) => Promise<void>
      onUpdate?: (
        ctx: GenericMutationCtx<DataModel>,
        newDoc: AuthTriggerDocument,
        oldDoc: AuthTriggerDocument,
      ) => Promise<void>
      onDelete?: (ctx: GenericMutationCtx<DataModel>, doc: AuthTriggerDocument) => Promise<void>
    }
  >
>

export type CreateAuth<
  DataModel extends GenericDataModel = GenericDataModel,
  Auth = ReturnType<typeof betterAuth>,
> = (ctx: AuthCtx<DataModel>) => Auth | Promise<Auth>

export type AuthAdapterComponentApi = ComponentApi

type AuthDocumentValue = string | number | boolean | string[] | number[] | null

/**
 * The live Better Auth user row, as admitted by the canonical session check.
 * Timestamps are epoch milliseconds.
 */
export interface BetterConvexAuthUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly emailVerified: boolean
  readonly image?: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly [field: string]: AuthDocumentValue | undefined
}

/** Claims of a Convex session token. Not revocation-aware on its own. */
export interface BetterConvexAuthSession {
  readonly userId: string
  readonly sessionId: string
}
