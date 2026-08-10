import type { FunctionReference } from 'convex/server'
import type { GenericId } from 'convex/values'
import { describe, expectTypeOf, it } from 'vitest'
import type { ComputedRef } from 'vue'

import type { UploadProgressInfo } from '../../src/runtime/composables/useConvexFileUpload'
import type { ConvexCallError } from '../../src/runtime/errors'

declare const useConvexFileUpload: (typeof import('../../src/runtime/composables/useConvexFileUpload'))['useConvexFileUpload']

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
declare const wrongReturnUploadUrl: FunctionReference<'mutation', 'public', NoArgs, number>
declare const internalUploadUrl: FunctionReference<'mutation', 'internal', NoArgs, string>

function uploadTypeContracts(file: File) {
  const noArgs = useConvexFileUpload(noArgsUploadUrl)
  expectTypeOf(noArgs.upload(file)).toEqualTypeOf<Promise<GenericId<'_storage'>>>()
  expectTypeOf(noArgs.data).toEqualTypeOf<ComputedRef<GenericId<'_storage'> | undefined>>()
  expectTypeOf(noArgs.error).toEqualTypeOf<ComputedRef<ConvexCallError | undefined>>()
  expectTypeOf(noArgs.progress).toEqualTypeOf<ComputedRef<UploadProgressInfo>>()
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

  // @ts-expect-error an upload URL mutation must return string
  useConvexFileUpload(wrongReturnUploadUrl)
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
