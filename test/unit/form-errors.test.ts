import { describe, expect, it } from 'vitest'

import { ConvexCallError } from '../../packages/vue/src/errors'
import {
  createSubmissionFormError,
  createValidationFormError,
} from '../../packages/vue/src/form-errors'

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
})
