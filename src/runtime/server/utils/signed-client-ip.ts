import type { H3Event } from 'h3'

import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  PUBLIC_ORIGIN_HEADER,
  PUBLIC_ORIGIN_SIGNATURE_HEADER,
  normalizeClientIp,
  requireProxyIpSecret,
  signClientIp,
  signPublicOrigin,
} from '../../shared/client-ip'

export interface SignedClientIpHeadersOptions {
  trustedClientIpHeader?: string | null
}

function readRequestHeader(event: H3Event, name: string): string | null {
  const directHeaders = (event as { headers?: { get?: (key: string) => string | null } }).headers
  const direct = directHeaders?.get?.(name)
  if (direct !== null && direct !== undefined) return direct

  const nodeHeaders = (
    event as {
      node?: { req?: { headers?: Record<string, string | string[] | undefined> } }
    }
  ).node?.req?.headers
  const value = nodeHeaders?.[name.toLowerCase()]
  if (Array.isArray(value)) return value.join(',')
  return typeof value === 'string' ? value : null
}

/** Build the complete authenticated client-IP pair for one Nuxt-to-Convex hop. */
export async function buildSignedClientIpHeaders(
  event: H3Event,
  options: SignedClientIpHeadersOptions,
): Promise<Record<string, string>> {
  const trustedHeader = options.trustedClientIpHeader
  if (!trustedHeader) return {}

  const clientIp = normalizeClientIp(readRequestHeader(event, trustedHeader))
  if (!clientIp) {
    throw new TypeError('Trusted client IP header must contain exactly one valid IP address')
  }
  const secret = requireProxyIpSecret(process.env.BCN_AUTH_PROXY_IP_SECRET)
  return {
    [CLIENT_IP_HEADER]: clientIp,
    [CLIENT_IP_SIGNATURE_HEADER]: await signClientIp(clientIp, secret),
  }
}

/**
 * The signed application origin for one Nuxt-to-Convex auth hop. Convex uses
 * it to serve several site origins from one deployment. Without
 * `BCN_AUTH_PROXY_IP_SECRET` (loopback development) no pair is sent and Convex
 * uses its `SITE_URL`.
 */
export async function buildSignedPublicOriginHeaders(
  origin: string,
): Promise<Record<string, string>> {
  const secret = process.env.BCN_AUTH_PROXY_IP_SECRET
  if (!secret) return {}
  return {
    [PUBLIC_ORIGIN_HEADER]: origin,
    [PUBLIC_ORIGIN_SIGNATURE_HEADER]: await signPublicOrigin(origin, requireProxyIpSecret(secret)),
  }
}
