import { describe, expect, it } from 'vitest'

import {
  McpAccessVerificationFailure,
  verifyAndNormalizeMcpAccess,
} from '../../packages/agents/src/access'
import type { McpAccessVerifier, VerifiedMcpAccess } from '../../packages/agents/src/access'

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

  it.each([
    new URL('https://mcp.example.test/api/mcp?tenant=one'),
    new URL('https://mcp.example.test/api/mcp#fragment'),
    new URL('https://user:secret@mcp.example.test/api/mcp'),
  ])('rejects an ambiguous configured resource before verifier work: %s', async (resource) => {
    let verifierCalls = 0
    await expect(
      verifyAndNormalizeMcpAccess({
        verifier: {
          async verifyAccessToken() {
            verifierCalls += 1
            return verified()
          },
        },
        token: 'must-not-reach-verifier',
        expectedIssuer: 'https://issuer.example.test/',
        expectedResource: resource,
      }),
    ).rejects.toThrow('Invalid access resource')
    expect(verifierCalls).toBe(0)
  })

  it('normalizes and freezes the exact allowlisted access context', async () => {
    let expectationWasFrozen = false
    let observedExpectation: { issuer: string; resource: string } | undefined
    const result = await verifyAndNormalizeMcpAccess({
      verifier: {
        async verifyAccessToken(_token, expected) {
          expectationWasFrozen = Object.isFrozen(expected)
          observedExpectation = {
            issuer: expected.issuer,
            resource: expected.resource.href,
          }
          expected.resource.pathname = '/verifier-local-mutation'
          return verified()
        },
      },
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
    expect(expectationWasFrozen).toBe(true)
    expect(observedExpectation).toEqual({
      issuer: 'https://issuer.example.test/',
      resource: expectedResource.href,
    })
    expect(expectedResource.href).toBe('https://mcp.example.test/api/mcp')
    expect(JSON.stringify(result)).not.toContain('raw-bearer-sentinel')
  })

  it.each(['https://issuer.example.test', 'https://issuer.example.test/'])(
    'preserves the exact valid issuer identifier %s',
    async (issuer) => {
      const result = await verifyAndNormalizeMcpAccess({
        verifier: verifier(verified({ access: { ...verified().access, issuer } })),
        token: 'exact-issuer-token',
        expectedIssuer: issuer,
        expectedResource,
        now: () => 1_800_000_000,
      })

      expect(result.access.issuer).toBe(issuer)
    },
  )

  it.each([
    ['an extra provider reference', { ...verified(), providerReference: 'must-not-cross' }],
    ['stale access', { ...verified(), expiresAt: 1_700_000_000 }],
    [
      'a rewritten issuer',
      verified({ access: { ...verified().access, issuer: 'https://issuer.example.test' } }),
    ],
    [
      'another resource',
      verified({ access: { ...verified().access, resource: 'https://other.example.test/mcp' } }),
    ],
    [
      'an unsafe scope',
      verified({ access: { ...verified().access, scopes: ['notes:read write'] } }),
    ],
  ] as Array<[string, VerifiedMcpAccess]>)(
    'rejects a verifier result with %s',
    async (_label, candidate) => {
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
    },
  )

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
