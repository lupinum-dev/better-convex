import { describe, expect, it, vi } from 'vitest'

import {
  getRequestBodySizeError,
  getResponseBodySizeError,
  readRequestBodyWithLimit,
  readResponseBodyWithLimit,
} from '../../src/runtime/server/api/auth/body-size'
import { fetchWithTimeout } from '../../src/runtime/server/utils/http'
import { runSeededAuthCorpus, type SeededRandom } from './seeded'

function bytes(length: number): Uint8Array {
  return new Uint8Array(length).fill(0x61)
}

function chunkedStream(input: Uint8Array, random: SeededRandom): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      let offset = 0
      while (offset < input.byteLength) {
        const remaining = input.byteLength - offset
        const size = Math.min(remaining, 1 + random.integer(Math.min(remaining, 17)))
        controller.enqueue(input.slice(offset, offset + size))
        offset += size
      }
      controller.close()
    },
  })
}

function eventFrom(stream: ReadableStream<Uint8Array>) {
  return {
    method: 'POST',
    node: { req: { socket: undefined } },
    web: { request: { body: stream } },
  } as never
}

describe('seeded auth proxy size and timeout boundaries', () => {
  it('enforces streamed and declared request/response byte limits at exactly N + 1', async () => {
    await runSeededAuthCorpus('proxy-body-size', 48, async (random) => {
      const limit = 1 + random.integer(512)

      expect(getRequestBodySizeError(String(limit), limit)).toBeNull()
      expect(getResponseBodySizeError(String(limit), limit)).toBeNull()
      expect(getRequestBodySizeError(String(limit + 1), limit)).toMatchObject({ statusCode: 413 })
      expect(getResponseBodySizeError(String(limit + 1), limit)).toMatchObject({ statusCode: 502 })

      await expect(
        readRequestBodyWithLimit(eventFrom(chunkedStream(bytes(limit), random)), limit),
      ).resolves.toHaveLength(limit)
      await expect(
        readRequestBodyWithLimit(eventFrom(chunkedStream(bytes(limit + 1), random)), limit),
      ).rejects.toMatchObject({
        code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE',
        statusCode: 413,
      })
      await expect(
        readResponseBodyWithLimit(new Response(chunkedStream(bytes(limit + 1), random)), limit),
      ).rejects.toMatchObject({
        code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE',
        statusCode: 502,
      })
    })
  })

  it('aborts stalled bodies only when the generated wall-clock deadline is reached', async () => {
    vi.useFakeTimers()
    try {
      await runSeededAuthCorpus('proxy-timeout', 24, async (random) => {
        const timeoutMs = 1 + random.integer(1_000)
        let upstreamSignal: AbortSignal | undefined
        const cancel = vi.fn()
        const response = await fetchWithTimeout('https://upstream.example.test', {
          fetchImpl: async (_input, init) => {
            upstreamSignal = init?.signal ?? undefined
            return new Response(new ReadableStream({ start() {}, cancel }))
          },
          timeoutMs,
        })
        const body = response.text()
        const bodyFailure = expect(body).rejects.toThrow(`Request timed out after ${timeoutMs}ms`)

        await vi.advanceTimersByTimeAsync(timeoutMs - 1)
        expect(upstreamSignal?.aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(upstreamSignal?.aborted).toBe(true)
        await bodyFailure
        expect(cancel).toHaveBeenCalledOnce()
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
