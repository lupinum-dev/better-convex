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
