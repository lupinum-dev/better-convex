import {
  ConvexFormError as VueConvexFormError,
  type ConvexFormErrorKind as VueConvexFormErrorKind,
} from '@lupinum/better-convex-vue'
import { ConvexFormError as VueErrorsEntryConvexFormError } from '@lupinum/better-convex-vue/errors'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { ConvexCallError } from '../../packages/vue/src/errors'
import {
  createSubmissionFormError,
  createValidationFormError,
} from '../../packages/vue/src/form-errors'
import type { ConvexFormError as NuxtRootConvexFormError } from '../../src/module'
import {
  ConvexFormError as NuxtErrorsEntryConvexFormError,
  type ConvexFormErrorKind as NuxtConvexFormErrorKind,
} from '../../src/runtime/errors'

describe('Convex form errors', () => {
  it('routes nested known paths and keeps pathless or unknown issues visible', () => {
    const error = createValidationFormError(
      [
        { message: 'Street is required', path: ['address', 'street'] },
        { message: 'Unknown field', path: ['removed'] },
        { message: 'Form combination is invalid' },
      ],
      new Set(['address']),
    )

    expect(error.fieldErrors.address).toEqual(['Street is required'])
    expect(error.issues[0]).toMatchObject({ field: 'address', path: ['address', 'street'] })
    expect(error.issues[1]?.field).toBeUndefined()
    expect(error.formError).toBe('Unknown field')
  })

  it('falls back safely when a mapper throws', () => {
    const callError = new ConvexCallError({ kind: 'server', message: 'Safe application error' })
    const error = createSubmissionFormError(callError, new Set(['email']), () => {
      throw new Error('private mapper failure')
    })

    expect(error.formError).toBe('Safe application error')
    expect(JSON.stringify(error)).not.toContain('private mapper failure')
  })

  it('keeps runtime-unknown mapped fields at form level', () => {
    const callError = new ConvexCallError({ kind: 'server', message: 'Application error' })
    const error = createSubmissionFormError<{ email: string }>(
      callError,
      new Set(['email']),
      () => ({ fields: { removed: 'The removed field failed' } }) as never,
    )

    expect(error.fieldErrors).toEqual({})
    expect(error.formError).toBe('The removed field failed')
  })

  it('exposes one ConvexFormError class from the Vue root, Vue /errors and Nuxt /errors', () => {
    expect(NuxtErrorsEntryConvexFormError).toBe(VueConvexFormError)
    expect(VueErrorsEntryConvexFormError).toBe(VueConvexFormError)
    expectTypeOf<NuxtRootConvexFormError>().toEqualTypeOf<VueConvexFormError>()
    expectTypeOf<NuxtConvexFormErrorKind>().toEqualTypeOf<VueConvexFormErrorKind>()

    const error = new NuxtErrorsEntryConvexFormError({ kind: 'validation', message: 'Invalid' })
    expect(error).toBeInstanceOf(VueConvexFormError)
    expect(error.toJSON()).toMatchObject({ name: 'ConvexFormError', kind: 'validation' })
  })
})
