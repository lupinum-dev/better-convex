import { describe, expect, it, vi } from 'vitest'

import { assertHostedSourceCertification } from '../../scripts/assert-hosted-source-certification.mjs'

const sha = 'a'.repeat(40)
const token = 'github-token-'.padEnd(32, 'x')

function response(check: Record<string, unknown>) {
  return new Response(JSON.stringify({ check_runs: [check] }), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('hosted source certification', () => {
  it('accepts one successful GitHub Actions release gate for the exact commit', async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        app: { slug: 'github-actions' },
        conclusion: 'success',
        head_sha: sha,
        name: 'release-gate',
        status: 'completed',
      }),
    )
    await expect(
      assertHostedSourceCertification({
        fetchImplementation,
        repository: 'lupinum-dev/better-convex-nuxt',
        sha,
        token,
      }),
    ).resolves.toMatchObject({ conclusion: 'success', head_sha: sha })
    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining(`/commits/${sha}/check-runs?check_name=release-gate`),
      expect.objectContaining({ redirect: 'error' }),
    )
  })

  it.each([
    ['wrong commit', { head_sha: 'b'.repeat(40), conclusion: 'success' }],
    ['pending', { head_sha: sha, conclusion: null, status: 'in_progress' }],
    ['failed', { head_sha: sha, conclusion: 'failure' }],
  ])('fails closed for %s', async (_name, override) => {
    await expect(
      assertHostedSourceCertification({
        fetchImplementation: async () =>
          response(
            Object.assign(
              {
                app: { slug: 'github-actions' },
                conclusion: 'success',
                head_sha: sha,
                name: 'release-gate',
                status: 'completed',
              },
              override,
            ),
          ),
        repository: 'lupinum-dev/better-convex-nuxt',
        sha,
        token,
      }),
    ).rejects.toThrow('no successful authoritative release-gate')
  })

  it('rejects oversized responses without exposing the token', async () => {
    const error = await assertHostedSourceCertification({
      fetchImplementation: async () =>
        new Response('x', { headers: { 'content-length': String(65 * 1024) } }),
      repository: 'lupinum-dev/better-convex-nuxt',
      sha,
      token,
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('byte bound')
    expect(error.message).not.toContain(token)
  })
})
