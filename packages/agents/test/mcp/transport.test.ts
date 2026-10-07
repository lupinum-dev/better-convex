import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  boundMcpResponse,
  McpTransportFailure,
  mcpTransportFailureResponse,
  prepareBoundedMcpRequest,
  runMcpRequestDeadline,
} from '../../src/transport'

const expectedMaximumRequestBytes = 65_536
const expectedMaximumResponseBytes = 1_048_576
const expectedRequestTimeoutMs = 30_000

afterEach(() => vi.useRealTimers())

describe('MCP transport bounds', () => {
  it('accepts the exact request limit and rejects declared or streamed overflow', async () => {
    const exactBody = 'a'.repeat(expectedMaximumRequestBytes)
    const exact = await prepareBoundedMcpRequest(
      new Request('https://notes.example.test/mcp', { body: exactBody, method: 'POST' }),
      new AbortController().signal,
    )
    await expect(exact.text()).resolves.toBe(exactBody)

    for (const request of [
      new Request('https://notes.example.test/mcp', {
        body: 'small',
        headers: { 'content-length': String(expectedMaximumRequestBytes + 1) },
        method: 'POST',
      }),
      new Request('https://notes.example.test/mcp', {
        body: 'a'.repeat(expectedMaximumRequestBytes + 1),
        method: 'POST',
      }),
    ]) {
      await expect(
        prepareBoundedMcpRequest(request, new AbortController().signal),
      ).rejects.toMatchObject({ status: 413 })
    }
  })

  // Cloud smoke, 2026-10-07: Convex's edge answered 520 instead of 413 when the door answered while
  // the client still uploaded. A refused upload up to 4 MiB is read to its end first; a larger
  // one is refused at once, so a client cannot keep the action busy.
  it.each([
    {
      row: 'declared, 1 MiB',
      declared: true,
      bytes: 1024 * 1024,
      read: 1024 * 1024,
      cancelled: false,
    },
    {
      row: 'streamed, 1 MiB',
      declared: false,
      bytes: 1024 * 1024,
      read: 1024 * 1024,
      cancelled: false,
    },
    { row: 'declared, 5 MiB', declared: true, bytes: 5 * 1024 * 1024, read: 0, cancelled: false },
    {
      row: 'streamed, 5 MiB',
      declared: false,
      bytes: 5 * 1024 * 1024,
      // 64 KiB to find the overflow, then 4 MiB and one chunk more while it discards.
      read: 4 * 1024 * 1024 + 3 * 64 * 1024,
      cancelled: true,
    },
  ])('reads a refused upload to its end only up to 4 MiB: $row', async (row) => {
    const chunk = new Uint8Array(64 * 1024)
    let read = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (read >= row.bytes) return controller.close()
          read += chunk.byteLength
          controller.enqueue(chunk)
        },
        cancel() {
          cancelled = true
        },
      },
      { highWaterMark: 0 },
    )
    const request = new Request('https://notes.example.test/mcp', {
      body,
      duplex: 'half',
      headers: row.declared ? { 'content-length': String(row.bytes) } : {},
      method: 'POST',
    } as RequestInit & { duplex: 'half' })
    await expect(
      prepareBoundedMcpRequest(request, new AbortController().signal),
    ).rejects.toMatchObject({ status: 413 })
    expect({ read, cancelled }).toEqual({ read: row.read, cancelled: row.cancelled })
  })

  it.each(['-1', '1.5', 'not-a-number'])(
    'rejects invalid declared request length: %s',
    async (length) => {
      await expect(
        prepareBoundedMcpRequest(
          new Request('https://notes.example.test/mcp', {
            body: 'small',
            headers: { 'content-length': length },
            method: 'POST',
          }),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 400 })
    },
  )

  it('cancels a stalled request stream when the caller aborts', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const controller = new AbortController()
    const request = new Request('https://notes.example.test/mcp', {
      body: stream,
      duplex: 'half',
      method: 'POST',
    } as RequestInit & { duplex: 'half' })
    const reason = new Error('request-stream-abort-sentinel')
    const pending = prepareBoundedMcpRequest(request, controller.signal)
    const rejected = expect(pending).rejects.toBe(reason)
    controller.abort(reason)
    await rejected
    expect(cancelled).toBe(true)
  })

  it('bounds JSON responses and rejects streaming or non-JSON responses', async () => {
    const exactBody = 'a'.repeat(expectedMaximumResponseBytes)
    const exact = await boundMcpResponse(
      new Response(exactBody, {
        headers: { 'content-type': 'application/json', 'x-test': 'kept' },
      }),
    )
    expect(exact.headers.get('x-test')).toBe('kept')
    await expect(exact.text()).resolves.toBe(exactBody)

    await expect(
      boundMcpResponse(
        new Response('a'.repeat(expectedMaximumResponseBytes + 1), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ).rejects.toMatchObject({ status: 502 })
    await expect(
      boundMcpResponse(
        new Response('small', {
          headers: {
            'content-length': String(expectedMaximumResponseBytes + 1),
            'content-type': 'application/json',
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 502 })

    const stream = new Response('data: alive\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })
    await expect(boundMcpResponse(stream)).rejects.toMatchObject({ status: 502 })
    await expect(boundMcpResponse(new Response('plain text'))).rejects.toMatchObject({
      status: 502,
    })
  })

  it('propagates caller abort and enforces the fixed settlement deadline', async () => {
    vi.useFakeTimers()
    const requestController = new AbortController()
    let operationSignal: AbortSignal | undefined
    const pending = runMcpRequestDeadline(requestController.signal, async (signal) => {
      operationSignal = signal
      return await new Promise<Response>(() => {})
    })
    const timedOut = expect(pending).rejects.toMatchObject({ status: 504 })
    await vi.advanceTimersByTimeAsync(expectedRequestTimeoutMs - 1)
    expect(operationSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await timedOut
    expect(operationSignal?.aborted).toBe(true)

    const aborted = new AbortController()
    const reason = new Error('caller-abort-sentinel')
    const abortedPending = runMcpRequestDeadline(aborted.signal, async () => {
      return await new Promise<Response>(() => {})
    })
    const callerAborted = expect(abortedPending).rejects.toBe(reason)
    aborted.abort(reason)
    await callerAborted
  })

  it('keeps the deadline active while a JSON response body is consumed', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const pending = runMcpRequestDeadline(new AbortController().signal, async (signal) => {
      return await boundMcpResponse(
        new Response(stream, { headers: { 'content-type': 'application/json' } }),
        signal,
      )
    })
    const timedOut = expect(pending).rejects.toMatchObject({ status: 504 })
    await vi.advanceTimersByTimeAsync(expectedRequestTimeoutMs)
    await timedOut
    expect(cancelled).toBe(true)
  })

  // Cloud smoke, 2026-10-07: Convex's edge replaced an empty 413 with a 520.
  it('returns short no-store JSON-RPC transport failures without retaining causes', async () => {
    const error = new McpTransportFailure(413)
    const response = mcpTransportFailureResponse(error)
    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'The request body is larger than 64 KiB.' },
    })
    expect(JSON.stringify(error)).not.toContain('cause')
  })
})
