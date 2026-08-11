const packedRuntimeFingerprint = '__BCN_RELEASE_RUNTIME_FINGERPRINT__'
const packedRuntimeFingerprintPattern = /^bcn-release-v1-[0-9a-f]{64}$/u

export const PACKED_RUNTIME_FINGERPRINT_HEADER = 'x-bcn-runtime-fingerprint'

/** Undefined in ordinary source/dev builds; populated only in immutable release bytes. */
export function getPackedRuntimeFingerprint(): string | undefined {
  return packedRuntimeFingerprintPattern.test(packedRuntimeFingerprint)
    ? packedRuntimeFingerprint
    : undefined
}

/** Bind a package-owned Web Response to the immutable candidate that produced it. */
export function bindPackedRuntimeFingerprint(response: Response): Response {
  const fingerprint = getPackedRuntimeFingerprint()
  if (!fingerprint) return response
  const headers = new Headers(response.headers)
  headers.set(PACKED_RUNTIME_FINGERPRINT_HEADER, fingerprint)
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}
