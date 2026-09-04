import type { FunctionReference, FunctionReturnType, PaginationResult } from 'convex/server'
import { expectTypeOf, it } from 'vitest'

import type { AuthDocument } from '../../src/runtime/convex-auth/adapter/query'
import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'

type Adapter = ComponentApi['adapter']

it('retains document, pagination, and count contracts in the real generated component API', () => {
  expectTypeOf<Adapter['assertProfile']>().toExtend<
    FunctionReference<'query', 'internal', { workforce: boolean }, null>
  >()
  expectTypeOf<FunctionReturnType<Adapter['create']>>().toEqualTypeOf<AuthDocument>()
  expectTypeOf<FunctionReturnType<Adapter['findOne']>>().toEqualTypeOf<AuthDocument | null>()
  expectTypeOf<FunctionReturnType<Adapter['sessionAdmission']>>().toEqualTypeOf<{
    user: AuthDocument
    session: AuthDocument
  } | null>()
  expectTypeOf<Adapter['sessionAdmission']>().toExtend<
    FunctionReference<'query', 'internal', { sessionId: string; userId?: string }>
  >()
  expectTypeOf<FunctionReturnType<Adapter['findMany']>>().toEqualTypeOf<
    PaginationResult<AuthDocument>
  >()
  expectTypeOf<FunctionReturnType<Adapter['updateOne']>>().toEqualTypeOf<AuthDocument | null>()
  expectTypeOf<FunctionReturnType<Adapter['incrementOne']>>().toEqualTypeOf<AuthDocument | null>()
  expectTypeOf<FunctionReturnType<Adapter['consumeOne']>>().toEqualTypeOf<AuthDocument | null>()
  expectTypeOf<FunctionReturnType<Adapter['deleteOne']>>().toEqualTypeOf<AuthDocument | null>()
  expectTypeOf<FunctionReturnType<Adapter['count']>>().toEqualTypeOf<number>()
  expectTypeOf<FunctionReturnType<Adapter['updateMany']>>().toEqualTypeOf<number>()
  expectTypeOf<FunctionReturnType<Adapter['deleteMany']>>().toEqualTypeOf<number>()
})
