import { describe, expect, it } from 'vitest'

import {
  OAuthSecurityError,
  parseBoundedFormBody,
  parseBoundedFormRequest,
} from '../../src/runtime/convex-auth/oauth-security'

function streamedForm(input: string) {
  const bytes = new TextEncoder().encode(input)
  let offset = 0
  let pulls = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, offset + 1))
      offset += 1
    },
  })
  const request = new Request('https://auth.example/oauth2/token', {
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    duplex: 'half',
  } as RequestInit)
  return { request, pulls: () => pulls }
}

describe('bounded OAuth form bodies', () => {
  it('accepts exactly the limit and preserves the provider-owned request body', async () => {
    const form = 'a=12345'
    const { request } = streamedForm(form)

    await expect(parseBoundedFormRequest(request, ['a'], form.length)).resolves.toEqual(
      new URLSearchParams(form),
    )
    await expect(request.text()).resolves.toBe(form)
  })

  it('stops a headerless stream at limit+1 instead of materializing the full body', async () => {
    const { request, pulls } = streamedForm(`a=${'x'.repeat(100)}`)

    await expect(parseBoundedFormRequest(request, ['a'], 8)).rejects.toBeInstanceOf(
      OAuthSecurityError,
    )
    expect(pulls()).toBeLessThan(100)
  })

  it('uses the same bounded reader for authorize forms and keeps the length precheck', async () => {
    const exact = streamedForm('state=x')
    await expect(parseBoundedFormBody(exact.request, 7)).resolves.toEqual(
      new URLSearchParams('state=x'),
    )

    const oversized = new Request('https://auth.example/oauth2/authorize', {
      body: 'state=x',
      headers: {
        'content-length': '9',
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    })
    await expect(parseBoundedFormBody(oversized, 8)).rejects.toBeInstanceOf(OAuthSecurityError)
  })
})
