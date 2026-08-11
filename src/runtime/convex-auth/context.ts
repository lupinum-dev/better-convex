import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from 'convex/server'

export type AuthCtx<DataModel extends GenericDataModel = GenericDataModel> =
  | GenericQueryCtx<DataModel>
  | GenericMutationCtx<DataModel>
  | GenericActionCtx<DataModel>

export type WritableAuthCtx<DataModel extends GenericDataModel = GenericDataModel> =
  | GenericMutationCtx<DataModel>
  | GenericActionCtx<DataModel>

export function isWritableAuthCtx<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
): ctx is WritableAuthCtx<DataModel> {
  return 'runMutation' in ctx && typeof ctx.runMutation === 'function'
}

export function requireWritableAuthCtx<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
): asserts ctx is WritableAuthCtx<DataModel> {
  if (!isWritableAuthCtx(ctx)) {
    throw new Error('AUTH_WRITE_REQUIRES_MUTATION_OR_ACTION')
  }
}
