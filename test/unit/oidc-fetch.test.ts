import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { idpFetch } from '../../src/runtime/convex-auth/oidc-fetch'
import { createFakeIdp, type FakeIdp } from '../helpers/fake-oidc-idp'

let idp: FakeIdp
let restore: () => void
let url: string

beforeEach(async () => {
  idp = await createFakeIdp()
  restore = idp.install()
  url = `${idp.issuer}/.well-known/openid-configuration`
})

afterEach(() => {
  restore()
  vi.useRealTimers()
})

function opaqueRedirect(): Response {
  const response = new Response(null, { status: 200 })
  Object.defineProperty(response, 'type', { value: 'opaqueredirect' })
  return response
}

function chunks(count: number, size: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent === count) return controller.close()
      sent += 1
      controller.enqueue(new Uint8Array(size).fill(0x20))
    },
  })
}

describe('OIDC fetch', () => {
  for (const testCase of [
    {
      name: '302 redirect',
      response: () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    },
    {
      name: '307 redirect',
      response: () =>
        new Response(null, { status: 307, headers: { location: 'http://169.254.169.254/' } }),
    },
    { name: 'opaque redirect', response: opaqueRedirect },
  ]) {
    it(`refuses ${testCase.name}`, async () => {
      const { response } = testCase
      idp.respond.discovery = response
      await expect(
        idpFetch(url, { method: 'GET' }, { deadline: Date.now() + 10_000, maxBytes: 65_536 }),
      ).rejects.toThrow('AUTH_OIDC_TRANSPORT:redirect')
    })
  }

  it('refuses a body over the limit without Content-Length', async () => {
    idp.respond.discovery = () => new Response(chunks(3, 600))
    await expect(
      idpFetch(url, { method: 'GET' }, { deadline: Date.now() + 10_000, maxBytes: 1_024 }),
    ).rejects.toThrow('AUTH_OIDC_TRANSPORT:too_large')
  })

  it('refuses a Content-Length over the limit before reading', async () => {
    let pulled = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true
          controller.close()
        },
      },
      { highWaterMark: 0 },
    )
    idp.respond.discovery = () => new Response(body, { headers: { 'content-length': '100000' } })
    await expect(
      idpFetch(url, { method: 'GET' }, { deadline: Date.now() + 10_000, maxBytes: 65_536 }),
    ).rejects.toThrow('AUTH_OIDC_TRANSPORT:too_large')
    expect(pulled).toBe(false)
  })

  it('times out at the deadline', async () => {
    vi.useFakeTimers()
    idp.respond.discovery = () => new Promise<Response>(() => {})
    let settled: unknown = 'pending'
    const pending = idpFetch(
      url,
      { method: 'GET' },
      { deadline: Date.now() + 10_000, maxBytes: 65_536 },
    ).catch((error: unknown) => {
      settled = error
    })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(settled).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(String(settled)).toBe('Error: AUTH_OIDC_TRANSPORT:timeout')
  })
})
