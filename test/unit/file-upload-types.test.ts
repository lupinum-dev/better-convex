import type { FunctionReference } from 'convex/server'
import type { GenericId } from 'convex/values'
import { describe, expectTypeOf, it } from 'vitest'
import type { ComputedRef } from 'vue'

import type {
  ConvexFileUploadResult,
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

  const requiredArgs = useConvexFileUpload(requiredArgsUploadUrl)
  void requiredArgs.upload(file, { workspaceId: 'workspace_1' })
  // @ts-expect-error validator-required mutation args cannot be omitted
  void requiredArgs.upload(file)
  // @ts-expect-error validator-derived mutation args reject the wrong shape
  void requiredArgs.upload(file, {})

  const optionalFields = useConvexFileUpload(optionalFieldsUploadUrl)
  void optionalFields.upload(file, {})
  void optionalFields.upload(file, { folder: 'avatars' })
  // @ts-expect-error a non-empty validator shape still owns an explicit args position
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

describe('single-file upload type contract', () => {
  it('keeps its compile-time contract executable by TypeScript', () => {
    expectTypeOf(uploadTypeContracts).toBeFunction()
  })
})
