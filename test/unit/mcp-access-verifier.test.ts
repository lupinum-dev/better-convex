import { generateKeyPairSync, sign, verify } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  McpAccessVerificationFailure,
  verifyAndNormalizeMcpAccess,
} from '../../packages/mcp/src/access'
import type { McpAccessVerifier, VerifiedMcpAccess } from '../../packages/mcp/src/index'

const expectedResource = new URL('https://mcp.example.test/api/mcp')
const expiration = 4_102_444_800

function verified(overrides: Partial<VerifiedMcpAccess> = {}): VerifiedMcpAccess {
  return {
    access: {
      issuer: 'https://issuer.example.test/',
      subject: 'subject-123',
      clientId: 'client-123',
      resource: expectedResource.href,
      scopes: ['notes:write', 'notes:read', 'notes:read'],
    },
    expiresAt: expiration,
    ...overrides,
  }
}

function verifier(result: VerifiedMcpAccess = verified()): McpAccessVerifier {
  return {
    async verifyAccessToken() {
      return result
    },
  }
}

describe('provider-neutral MCP access verification boundary', () => {
  it('permits loopback HTTP for local Convex development but rejects remote plaintext resources', async () => {
    const loopback = new URL('http://127.0.0.1:3210/mcp')
    const loopbackIssuer = 'http://127.0.0.1:3200/api/auth'
    await expect(
      verifyAndNormalizeMcpAccess({
        verifier: verifier(
          verified({
            access: {
              ...verified().access,
              issuer: loopbackIssuer,
              resource: loopback.href,
            },
          }),
        ),
        token: 'loopback-token',
        expectedIssuer: loopbackIssuer,
        expectedResource: loopback,
      }),
    ).resolves.toMatchObject({
      access: { issuer: loopbackIssuer, resource: loopback.href },
    })

    const plaintext = new URL('http://resource.example.test/mcp')
    await expect(
      verifyAndNormalizeMcpAccess({
        verifier: verifier(
          verified({ access: { ...verified().access, resource: plaintext.href } }),
        ),
        token: 'plaintext-token',
        expectedIssuer: verified().access.issuer,
        expectedResource: plaintext,
      }),
    ).rejects.toThrow('Invalid access resource')

    await expect(
      verifyAndNormalizeMcpAccess({
        verifier: verifier(),
        token: 'plaintext-issuer-token',
        expectedIssuer: 'http://issuer.example.test/',
        expectedResource,
      }),
    ).rejects.toThrow('Invalid access issuer')
  })

  it('normalizes and freezes the exact allowlisted access context', async () => {
    const result = await verifyAndNormalizeMcpAccess({
      verifier: verifier(),
      token: 'raw-bearer-sentinel',
      expectedIssuer: 'https://issuer.example.test/',
      expectedResource,
      now: () => 1_800_000_000,
    })

    expect(result).toEqual({
      access: {
        issuer: 'https://issuer.example.test/',
        subject: 'subject-123',
        clientId: 'client-123',
        resource: expectedResource.href,
        scopes: ['notes:read', 'notes:write'],
      },
      expiresAt: expiration,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.access)).toBe(true)
    expect(Object.isFrozen(result.access.scopes)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('raw-bearer-sentinel')
  })

  it('lets a Better Auth-shaped verifier use a private grant reference without exposing it', async () => {
    const bearer = 'better-auth-token-sentinel'
    const providerReference = 'private-grant-reference-sentinel'
    let privateReferenceWasChecked = false
    const betterAuthFake: McpAccessVerifier = {
      async verifyAccessToken(token, resource) {
        if (token !== bearer || resource.href !== expectedResource.href) throw new Error('invalid')
        privateReferenceWasChecked = providerReference === 'private-grant-reference-sentinel'
        return verified()
      },
    }

    const result = await verifyAndNormalizeMcpAccess({
      verifier: betterAuthFake,
      token: bearer,
      expectedIssuer: 'https://issuer.example.test/',
      expectedResource,
      now: () => 1_800_000_000,
    })

    expect(privateReferenceWasChecked).toBe(true)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(bearer)
    expect(serialized).not.toContain(providerReference)
    expect(Object.keys(result.access).sort()).toEqual([
      'clientId',
      'issuer',
      'resource',
      'scopes',
      'subject',
    ])
  })

  it('accepts a materially external verifier using only a public signature key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const payload = Buffer.from(
      JSON.stringify({
        issuer: 'https://external.example.test/',
        subject: 'external-subject',
        clientId: 'external-client',
        resource: expectedResource.href,
        scopes: ['notes:read'],
        expiresAt: expiration,
      }),
    )
    const token = `${payload.toString('base64url')}.${sign(null, payload, privateKey).toString('base64url')}`
    const externalVerifier: McpAccessVerifier = {
      async verifyAccessToken(candidate, resource) {
        const [encodedPayload, encodedSignature, extra] = candidate.split('.')
        if (!encodedPayload || !encodedSignature || extra) throw new Error('invalid token')
        const signedPayload = Buffer.from(encodedPayload, 'base64url')
        if (!verify(null, signedPayload, publicKey, Buffer.from(encodedSignature, 'base64url'))) {
          throw new Error('invalid signature')
        }
        const claims = JSON.parse(signedPayload.toString('utf8')) as {
          issuer: string
          subject: string
          clientId: string
          resource: string
          scopes: string[]
          expiresAt: number
        }
        if (claims.resource !== resource.href) throw new Error('wrong resource')
        const { expiresAt, ...access } = claims
        return { access, expiresAt }
      },
    }

    await expect(
      verifyAndNormalizeMcpAccess({
        verifier: externalVerifier,
        token,
        expectedIssuer: 'https://external.example.test/',
        expectedResource,
        now: () => 1_800_000_000,
      }),
    ).resolves.toMatchObject({
      access: {
        issuer: 'https://external.example.test/',
        subject: 'external-subject',
      },
    })
  })

  it('rejects non-exact verifier results, stale access, and wrong resources', async () => {
    const cases: VerifiedMcpAccess[] = [
      { ...verified(), providerReference: 'must-not-cross' } as VerifiedMcpAccess,
      { ...verified(), expiresAt: 1_700_000_000 },
      verified({ access: { ...verified().access, issuer: 'https://issuer.example.test' } }),
      verified({ access: { ...verified().access, resource: 'https://other.example.test/mcp' } }),
      verified({ access: { ...verified().access, scopes: ['notes:read write'] } }),
    ]

    for (const candidate of cases) {
      await expect(
        verifyAndNormalizeMcpAccess({
          verifier: verifier(candidate),
          token: 'invalid-result-token-sentinel',
          expectedIssuer: 'https://issuer.example.test/',
          expectedResource,
          now: () => 1_800_000_000,
        }),
      ).rejects.toMatchObject({
        name: 'McpAccessVerificationFailure',
        message: 'MCP access token verification failed',
      })
    }
  })

  it('does not retain or serialize verifier errors, tokens, or provider references', async () => {
    const secrets = [
      'throwing-token-sentinel',
      'provider-reference-in-upstream-error',
      'upstream-stack-sentinel',
    ]
    let failure: unknown
    try {
      await verifyAndNormalizeMcpAccess({
        verifier: {
          async verifyAccessToken() {
            throw new Error(`${secrets[1]} ${secrets[2]}`)
          },
        },
        token: secrets[0]!,
        expectedIssuer: 'https://issuer.example.test/',
        expectedResource,
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(McpAccessVerificationFailure)
    expect(failure).not.toHaveProperty('code')
    const serialized = `${JSON.stringify(failure)} ${String(failure)}`
    for (const secret of secrets) expect(serialized).not.toContain(secret)
    expect(failure).not.toHaveProperty('cause')
  })
})
