export function bodyChunkBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  throw new TypeError('[better-convex-nuxt] Body stream yielded an unsupported chunk.')
}

async function readNextChunk(
  reader: ReadableStreamDefaultReader<unknown>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<unknown>> {
  if (!signal) return await reader.read()
  if (signal.aborted) throw signal.reason
  return await new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Body read was aborted'))
    signal.addEventListener('abort', abort, { once: true })
    reader
      .read()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

function cancelReader(reader: ReadableStreamDefaultReader<unknown>, reason: unknown): void {
  try {
    void reader.cancel(reason).catch(() => {})
  } catch {
    // Cancellation is best effort after the stream itself has failed.
  }
}

export async function readStreamWithByteLimit(
  stream: ReadableStream<unknown> | null | undefined,
  maxBytes: number,
  createSizeError: (observedBytes: number, maxBytes: number) => unknown,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> {
  if (!stream) return undefined

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await readNextChunk(reader, signal)
      if (done) break
      const chunk = bodyChunkBytes(value)
      totalBytes += chunk.byteLength
      if (totalBytes > maxBytes) throw createSizeError(totalBytes, maxBytes)
      chunks.push(chunk)
    }
  } catch (error) {
    cancelReader(reader, error)
    throw error
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
