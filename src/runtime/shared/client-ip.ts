const HMAC_ALGORITHM = 'HMAC'
const HMAC_HASH = 'SHA-256'
const SIGNATURE_PREFIX = 'v1\n'

const MAX_CLIENT_IP_INPUT_LENGTH = 45
const HMAC_SHA256_BYTE_LENGTH = 32
const HMAC_SHA256_BASE64URL_LENGTH = 43
const MIN_PROXY_IP_SECRET_BYTE_LENGTH = 32
const MAX_PROXY_IP_SECRET_BYTE_LENGTH = 1024

/** Reserved request headers used only between the Nuxt proxy and Convex. */
export const CLIENT_IP_HEADER = 'x-bcn-client-ip'
export const CLIENT_IP_SIGNATURE_HEADER = 'x-bcn-client-ip-signature'
export const VERIFIED_CLIENT_IP_HEADER = 'x-bcn-verified-client-ip'

function hasUnsafeHeaderCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 32 || code === 127) return true
  }
  return false
}

function normalizeIpv4(value: string): string | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null

  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return null
    if (Number(part) > 255) return null
  }

  return parts.join('.')
}

function normalizeIpv6(value: string): string | null {
  if (!value.includes(':') || value.includes('%') || value.includes('[') || value.includes(']')) {
    return null
  }

  try {
    const hostname = new URL(`http://[${value}]/`).hostname
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null
    return hostname.slice(1, -1).toLowerCase()
  } catch {
    return null
  }
}

/**
 * Parse one unambiguous IP literal and return its canonical text form.
 * Forwarding chains, ports, zone identifiers, whitespace, and control bytes
 * are deliberately outside this protocol.
 */
export function normalizeClientIp(value: string | null | undefined): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_CLIENT_IP_INPUT_LENGTH ||
    hasUnsafeHeaderCharacter(value) ||
    value.includes(',')
  ) {
    return null
  }

  return value.includes(':') ? normalizeIpv6(value) : normalizeIpv4(value)
}

function secretBytes(secret: string | null | undefined): Uint8Array | null {
  if (typeof secret !== 'string') return null
  const bytes = new TextEncoder().encode(secret)
  if (
    bytes.byteLength < MIN_PROXY_IP_SECRET_BYTE_LENGTH ||
    bytes.byteLength > MAX_PROXY_IP_SECRET_BYTE_LENGTH
  ) {
    return null
  }
  return bytes
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  return owned.buffer
}

/** Throw when the proxy IP secret cannot safely key HMAC-SHA-256. */
export function requireProxyIpSecret(secret: string | null | undefined): string {
  if (!secretBytes(secret)) {
    throw new TypeError('BCN_AUTH_PROXY_IP_SECRET must contain 32 to 1024 UTF-8 bytes')
  }
  return secret as string
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function strictBase64UrlSignature(value: string | null | undefined): Uint8Array | null {
  if (
    typeof value !== 'string' ||
    value.length !== HMAC_SHA256_BASE64URL_LENGTH ||
    !/^[\w-]{43}$/.test(value)
  ) {
    return null
  }

  try {
    const base64 = `${value.replaceAll('-', '+').replaceAll('_', '/')}=`
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    if (bytes.byteLength !== HMAC_SHA256_BYTE_LENGTH) return null
    return bytesToBase64Url(bytes) === value ? bytes : null
  } catch {
    return null
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    ownedArrayBuffer(secretBytes(secret) as Uint8Array),
    { name: HMAC_ALGORITHM, hash: HMAC_HASH },
    false,
    ['sign', 'verify'],
  )
}

function signatureInput(clientIp: string): ArrayBuffer {
  return ownedArrayBuffer(new TextEncoder().encode(`${SIGNATURE_PREFIX}${clientIp}`))
}

/** Sign one canonical client IP for the private Nuxt-to-Convex hop. */
export async function signClientIp(clientIp: string, secret: string): Promise<string> {
  const normalized = normalizeClientIp(clientIp)
  if (!normalized) throw new TypeError('Client IP must be one valid IP literal')
  requireProxyIpSecret(secret)

  const signature = await crypto.subtle.sign(
    HMAC_ALGORITHM,
    await importHmacKey(secret),
    signatureInput(normalized),
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

/**
 * Verify a complete signed pair and return only a canonical authenticated IP.
 * Invalid configuration and malformed attacker input are indistinguishable to
 * callers. An absent pair permits direct Convex request metadata; once either
 * reserved header is present, the component rejects an invalid pair.
 */
export async function verifySignedClientIp(
  clientIp: string | null,
  signature: string | null,
  secret: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizeClientIp(clientIp)
  const signatureBytes = strictBase64UrlSignature(signature)
  const keyBytes = secretBytes(secret)
  if (!normalized || normalized !== clientIp || !signatureBytes || !keyBytes) return null

  try {
    const verified = await crypto.subtle.verify(
      HMAC_ALGORITHM,
      await importHmacKey(secret as string),
      ownedArrayBuffer(signatureBytes),
      signatureInput(normalized),
    )
    return verified ? normalized : null
  } catch {
    return null
  }
}
