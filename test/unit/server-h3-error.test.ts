import { inspect } from 'node:util'

import { ConvexError } from 'convex/values'
import { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'

import { ConvexCallError, normalizeConvexError } from '../../src/runtime/errors'
import { toConvexH3Error } from '../../src/runtime/server/utils/h3-error'

const SECRET = 'better-auth.session_token=h3-error-secret-cookie'

describe('toConvexH3Error', () => {
  it.each([
    [new ConvexCallError({ kind: 'authentication', message: 'Sign in' }), 401],
    [new ConvexCallError({ kind: 'authentication', message: 'Sign in', status: 401 }), 401],
    [new ConvexCallError({ kind: 'authentication', message: 'Forbidden', status: 403 }), 403],
    [new ConvexCallError({ kind: 'authentication', message: 'Odd', status: 500 }), 401],
    [new ConvexCallError({ kind: 'transport', message: 'Timed out', status: 504 }), 502],
    [new ConvexCallError({ kind: 'server', message: 'Conflict', status: 409 }), 409],
    [new ConvexCallError({ kind: 'server', message: 'Teapot', status: 418 }), 418],
    [new ConvexCallError({ kind: 'server', message: 'No status' }), 400],
    [new ConvexCallError({ kind: 'server', message: 'Upstream', status: 503 }), 400],
    [new ConvexCallError({ kind: 'server', message: 'Redirect', status: 302 }), 400],
    [new ConvexCallError({ kind: 'unknown', message: 'Unknown' }), 500],
  ])('maps %o to HTTP %i', (error, statusCode) => {
    const h3Error = toConvexH3Error(error)

    expect(h3Error).toBeInstanceOf(H3Error)
    expect(h3Error.statusCode).toBe(statusCode)
    expect(h3Error.message).toBe(error.message)
    expect(h3Error.data).toEqual(error.toJSON())
  })

  it('keeps a Convex application status and data from a ConvexError', () => {
    const h3Error = toConvexH3Error(
      new ConvexError({ code: 'NOTE_LOCKED', status: 423, message: 'The note is locked' }),
    )

    expect(h3Error.statusCode).toBe(423)
    expect(h3Error.data).toMatchObject({
      name: 'ConvexCallError',
      kind: 'server',
      code: 'NOTE_LOCKED',
      status: 423,
      data: { code: 'NOTE_LOCKED', status: 423, message: 'The note is locked' },
    })
  })

  it('never copies a raw cause, message, or stack into the H3 error', () => {
    const raw = new Error(`upstream failed with ${SECRET}`)
    raw.stack = `Error: ${SECRET}\n    at secret-frame`
    const h3Error = toConvexH3Error(raw)

    expect(h3Error.statusCode).toBe(500)
    expect(h3Error.cause).toBeUndefined()
    expect(h3Error.data).toEqual(
      new ConvexCallError({ kind: 'unknown', message: h3Error.message }).toJSON(),
    )
    for (const rendered of [
      JSON.stringify(h3Error),
      JSON.stringify(h3Error.data),
      h3Error.message,
      String(h3Error.stack),
      inspect(h3Error, { depth: 10 }),
    ]) {
      expect(rendered).not.toContain(SECRET)
      expect(rendered).not.toContain('secret-frame')
    }
  })

  it('round-trips through the H3 error, its JSON body, and an ofetch FetchError', () => {
    const original = new ConvexCallError({
      kind: 'authentication',
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
      status: 401,
      functionName: 'notes:list',
    })
    const h3Error = toConvexH3Error(original)
    const body = JSON.parse(JSON.stringify(h3Error)) as Record<string, unknown>
    const fetchError = Object.assign(new Error('[GET] "/api/notes": 401'), { data: body })

    for (const wire of [h3Error, body, fetchError]) {
      const revived = normalizeConvexError(wire)
      expect(revived).toBeInstanceOf(ConvexCallError)
      expect(revived.toJSON()).toEqual({ ...original.toJSON(), functionName: undefined })
    }
  })

  it('keeps the Convex function path out of the public response body', () => {
    const original = new ConvexCallError({
      kind: 'server',
      code: 'CARD_DECLINED',
      message: 'The card was declined',
      functionName: 'admin/billing:chargeCustomer',
    })
    const h3Error = toConvexH3Error(original)

    expect(h3Error.data?.functionName).toBeUndefined()
    expect(JSON.stringify(h3Error)).not.toContain('admin/billing:chargeCustomer')
    expect(original.functionName).toBe('admin/billing:chargeCustomer')
  })
})
