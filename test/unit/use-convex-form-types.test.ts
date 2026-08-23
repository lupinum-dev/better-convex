import { type } from 'arktype'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { useConvexForm } from '../../packages/vue/src'

const mutation = makeFunctionReference<'mutation'>('members:invite') as FunctionReference<
  'mutation',
  'public',
  { organizationId: string; email: string; role?: 'member' | 'admin' },
  { memberId: string }
>

function formTypeContract() {
  const arkSchema = type({
    email: 'string.email',
    role: "'member'|'admin'",
  })
  const arkForm = useConvexForm(mutation, {
    schema: arkSchema,
    toArgs: (values) => ({ email: values.email, role: values.role }),
  })
  void arkForm.submit({ email: 'person@example.com', role: 'member' }, { organizationId: 'org' })

  const direct = useConvexForm(mutation, {
    schema: z.object({
      organizationId: z.string(),
      email: z.string().email(),
      role: z.enum(['member', 'admin']).optional(),
    }),
  })
  const directResult = direct.submit({ organizationId: 'org', email: 'person@example.com' })
  expectTypeOf(directResult).toEqualTypeOf<
    Promise<
      | { readonly ok: true; readonly data: { memberId: string } }
      | { readonly ok: false; readonly error: import('../../packages/vue/src').ConvexFormError }
    >
  >()

  const mapped = useConvexForm(mutation, {
    schema: z.object({
      email: z.string().transform((value) => value.trim()),
      role: z.enum(['member', 'admin']),
    }),
    toArgs: (values) => ({ email: values.email, role: values.role }),
    mapError: () => ({ fields: { email: 'Already invited' } }),
  })
  void mapped.submit({ email: 'person@example.com', role: 'member' }, { organizationId: 'org' })

  // @ts-expect-error The contextual organization ID is still required.
  void mapped.submit({ email: 'person@example.com', role: 'member' })
  void mapped.submit(
    { email: 'person@example.com', role: 'member' },
    // @ts-expect-error Produced form arguments cannot be repeated as contextual arguments.
    { organizationId: 'org', email: 'override@example.com' },
  )
  // @ts-expect-error The mapped email must satisfy the mutation's string argument.
  useConvexForm(mutation, {
    schema: z.object({ email: z.string() }),
    toArgs: (values) => ({ email: values.email.length }),
  })
  useConvexForm(mutation, {
    schema: z.object({ email: z.string() }),
    // @ts-expect-error Error mappings only accept known submitted fields.
    mapError: () => ({ fields: { missing: 'Unknown field' } }),
  })
}

describe('useConvexForm type contract', () => {
  it('is checked by TypeScript without executing composables', () => {
    expect(formTypeContract).toBeTypeOf('function')
  })
})
