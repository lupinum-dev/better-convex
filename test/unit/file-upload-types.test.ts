import type { FunctionReference } from 'convex/server'
import type { GenericId } from 'convex/values'
import { describe, expectTypeOf, it } from 'vitest'
import type { ComputedRef } from 'vue'

import type {
  ConvexFileUploadResult,
  UploadCompleteContext,
  UploadProgressInfo,
} from '../../src/runtime/composables/useConvexFileUpload'
import type { ConvexOperation } from '../../src/runtime/composables/useConvexOperation'
import type { ConvexCallError } from '../../src/runtime/errors'

declare const useConvexFileUpload: (typeof import('../../src/runtime/composables/useConvexFileUpload'))['useConvexFileUpload']
declare const useVueConvexFileUpload: (typeof import('../../packages/vue/src'))['useConvexFileUpload']

type NoArgs = Record<string, never>

declare const noArgsUploadUrl: FunctionReference<'mutation', 'public', NoArgs, string>
declare const requiredArgsUploadUrl: FunctionReference<
  'mutation',
  'public',
  { workspaceId: string },
  string
>
declare const optionalFieldsUploadUrl: FunctionReference<
  'mutation',
  'public',
  { folder?: string },
  string
>
declare const sessionUploadUrl: FunctionReference<
  'mutation',
  'public',
  NoArgs,
  { uploadUrl: string; sessionId: string }
>
declare const internalUploadUrl: FunctionReference<'mutation', 'internal', NoArgs, string>
declare const claimMutation: FunctionReference<
  'mutation',
  'public',
  { sessionId: string; storageId: string },
  { fileId: string }
>
declare const attachAction: FunctionReference<'action', 'public', { storageId: string }, number>
declare const internalClaim: FunctionReference<'mutation', 'internal', { storageId: string }, null>
type AssetId = GenericId<'assets'>
declare const attachToAsset: FunctionReference<
  'mutation',
  'public',
  { assetId: AssetId; storageId: string },
  null
>

function uploadTypeContracts(file: File) {
  const noArgs = useConvexFileUpload(noArgsUploadUrl)
  expectTypeOf(noArgs.upload(file)).toEqualTypeOf<
    Promise<ConvexFileUploadResult<string, undefined>>
  >()
  expectTypeOf(noArgs.data).toEqualTypeOf<
    ComputedRef<ConvexFileUploadResult<string, undefined> | undefined>
  >()
  void noArgs.upload(file).then(({ storageId }) => {
    expectTypeOf(storageId).toEqualTypeOf<GenericId<'_storage'>>()
  })
  expectTypeOf(noArgs.error).toEqualTypeOf<ComputedRef<ConvexCallError | undefined>>()
  expectTypeOf(noArgs.progress).toEqualTypeOf<ComputedRef<UploadProgressInfo>>()
  expectTypeOf(noArgs.cancel).toEqualTypeOf<() => void>()
  expectTypeOf(noArgs.reset).toEqualTypeOf<() => void>()
  // The Nuxt facade returns exactly the Vue lifecycle's state.
  expectTypeOf(noArgs).toEqualTypeOf(useVueConvexFileUpload(noArgsUploadUrl))
  void noArgs.upload(file, {})
  void noArgs.upload(file, { args: {} })

  const requiredArgs = useConvexFileUpload(requiredArgsUploadUrl)
  void requiredArgs.upload(file, { args: { workspaceId: 'workspace_1' } })
  // @ts-expect-error validator-required mutation args cannot be omitted
  void requiredArgs.upload(file)
  // @ts-expect-error validator-derived mutation args reject the wrong shape
  void requiredArgs.upload(file, {})
  // @ts-expect-error validator-derived args must have the required fields
  void requiredArgs.upload(file, { args: {} })
  // @ts-expect-error mutation arguments belong inside the options object
  void requiredArgs.upload(file, { workspaceId: 'workspace_1' })

  const optionalFields = useConvexFileUpload(optionalFieldsUploadUrl)
  void optionalFields.upload(file, {})
  void optionalFields.upload(file, { args: { folder: 'avatars' } })
  void optionalFields.upload(file)

  // @ts-expect-error a non-string upload-URL result requires `url`
  useConvexFileUpload(sessionUploadUrl)
  // @ts-expect-error a non-string upload-URL result requires `url`
  useConvexFileUpload(sessionUploadUrl, { maxSize: 1 })
  const session = useConvexFileUpload(sessionUploadUrl, {
    url: (prepared) => prepared.uploadUrl,
    complete: (op, { prepared, storageId, file: stored }) => {
      expectTypeOf(op).toEqualTypeOf<ConvexOperation>()
      expectTypeOf(stored).toEqualTypeOf<File>()
      return op.mutation(claimMutation, { sessionId: prepared.sessionId, storageId })
    },
  })
  expectTypeOf(session.data).toEqualTypeOf<
    ComputedRef<
      | ConvexFileUploadResult<{ uploadUrl: string; sessionId: string }, { fileId: string }>
      | undefined
    >
  >()

  const attached = useConvexFileUpload(noArgsUploadUrl, {
    complete: (op, { storageId }) => op.action(attachAction, { storageId }),
  })
  void attached.upload(file).then(({ completed }) => {
    expectTypeOf(completed).toEqualTypeOf<number>()
  })
  // A completion may send several steps; its own return value becomes `completed`.
  const claimedThenAttached = useConvexFileUpload(sessionUploadUrl, {
    url: (prepared) => prepared.uploadUrl,
    complete: async (op, { prepared, storageId }) => {
      const claimed = await op.mutation(claimMutation, { sessionId: prepared.sessionId, storageId })
      return { claimed, attached: await op.action(attachAction, { storageId }) }
    },
  })
  void claimedThenAttached.upload(file).then(({ completed }) => {
    expectTypeOf(completed).toEqualTypeOf<{ claimed: { fileId: string }; attached: number }>()
  })
  useConvexFileUpload(noArgsUploadUrl, {
    // @ts-expect-error an action cannot be sent as a mutation
    complete: (op, { storageId }) => op.mutation(attachAction, { storageId }),
  })
  useConvexFileUpload(noArgsUploadUrl, {
    // @ts-expect-error completion args are validator-derived
    complete: (op, { storageId }) => op.mutation(claimMutation, { storageId }),
  })
  useConvexFileUpload(noArgsUploadUrl, {
    // @ts-expect-error browser composables complete with public functions only
    complete: (op, { storageId }) => op.mutation(internalClaim, { storageId }),
  })
  useConvexFileUpload(noArgsUploadUrl, {
    // @ts-expect-error the completion is asynchronous work through the operation
    complete: () => 'done',
  })
  // @ts-expect-error browser composables accept public mutations only
  useConvexFileUpload(internalUploadUrl)
  // @ts-expect-error completion is observed through await/catch, not callbacks
  useConvexFileUpload(noArgsUploadUrl, { onSuccess: () => {} })
  // @ts-expect-error granular progress is readonly state, not a callback
  useConvexFileUpload(noArgsUploadUrl, { onProgress: () => {} })

  useConvexFileUpload(noArgsUploadUrl, {
    maxSize: 5 * 1024 * 1024,
    allowedTypes: ['image/*'] as const,
  })
}

function uploadContextTypeContracts(file: File, assetId: AssetId, operation: ConvexOperation) {
  // The completion declares its per-call context; upload() infers and requires it.
  const toAsset = useConvexFileUpload(noArgsUploadUrl, {
    complete: (op, { storageId, context }: UploadCompleteContext<string, AssetId>) =>
      op.mutation(attachToAsset, { assetId: context, storageId }),
  })
  void toAsset.upload(file, { context: assetId })
  void toAsset.upload(file, { args: {}, context: assetId })
  // @ts-expect-error the old positional context parameter is removed
  void toAsset.upload(file, {}, { context: assetId })
  // @ts-expect-error a declared context is required, so the target is never implicit
  void toAsset.upload(file)
  // @ts-expect-error a declared context is required, so the target is never implicit
  void toAsset.upload(file, {})
  // @ts-expect-error the context type is inferred from the completion
  void toAsset.upload(file, { context: 'asset_1' })
  expectTypeOf(toAsset).toEqualTypeOf(
    useVueConvexFileUpload(noArgsUploadUrl, {
      complete: (op, { storageId, context }: UploadCompleteContext<string, AssetId>) =>
        op.mutation(attachToAsset, { assetId: context, storageId }),
    }),
  )

  // The URL selector receives the same context; required args and context share options.
  const scoped = useConvexFileUpload(requiredArgsUploadUrl, {
    url: (prepared, { context, file: selected }: { file: File; context: { folder: string } }) => {
      expectTypeOf(selected).toEqualTypeOf<File>()
      return `${prepared}?folder=${context.folder}`
    },
  })
  void scoped.upload(file, { args: { workspaceId: 'workspace_1' }, context: { folder: 'a' } })
  // @ts-expect-error required upload-URL args cannot be omitted
  void scoped.upload(file, { context: { folder: 'a' } })
  // @ts-expect-error required context cannot be omitted even when args are present
  void scoped.upload(file, { args: { workspaceId: 'workspace_1' } })
  // @ts-expect-error both required args and context need an options object
  void scoped.upload(file)

  // A context that admits `undefined` stays optional.
  const optionalContext = useConvexFileUpload(noArgsUploadUrl, {
    complete: async (_op, { context }: UploadCompleteContext<string, AssetId | undefined>) =>
      context,
  })
  void optionalContext.upload(file)
  void optionalContext.upload(file, { context: assetId })

  // Without a declared context, `ctx.context` is `undefined` and none may be passed.
  const plain = useConvexFileUpload(noArgsUploadUrl, {
    complete: async (_op, { context }) => {
      expectTypeOf(context).toEqualTypeOf<undefined>()
      return 1
    },
  })
  void plain.upload(file)
  // @ts-expect-error no context was declared
  void plain.upload(file, { context: assetId })

  // op.upload() accepts the same client-side limits as the composable.
  void operation.upload('https://upload.test', file, {
    maxSize: 1024,
    allowedTypes: ['image/*'],
    onProgress: () => {},
  })
  // @ts-expect-error maxSize is a byte count
  void operation.upload('https://upload.test', file, { maxSize: '1mb' })
}

describe('single-file upload type contract', () => {
  it('keeps its compile-time contract executable by TypeScript', () => {
    expectTypeOf(uploadTypeContracts).toBeFunction()
    expectTypeOf(uploadContextTypeContracts).toBeFunction()
  })
})
