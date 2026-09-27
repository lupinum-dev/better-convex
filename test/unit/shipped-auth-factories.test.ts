import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { escapeEmailHtml } from '../../starters/team/convex/lib/authEmail'

// Starters and examples are copied verbatim by users, so their secret handling
// is part of the shipped security surface.
const repoRoot = join(import.meta.dirname, '../..')
const authApps = ['demo', 'playground', 'starters/agency', 'starters/team'] as const
const authEnvExamples = [
  'demo/.env.example',
  'starters/agency/.env.example',
  'starters/mcp-oauth-agent/.env.example',
  'starters/team/.env.example',
] as const

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

describe('shipped Better Auth factory invariants', () => {
  it('escapes every user-controlled transactional-email HTML delimiter', () => {
    expect(escapeEmailHtml(`<img src=x onerror="alert('x')"> & invited`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; invited',
    )
  })

  it.each(authApps)('%s uses the owned Better Auth factory without a secret fallback', (app) => {
    const auth = read(`${app}/convex/auth.ts`)

    expect(auth).toContain('createBetterConvexAuth<DataModel>')
    expect(auth).not.toContain('BETTER_AUTH_SECRET ??')
    expect(auth).not.toContain('secret: process.env')
    expect(auth).not.toContain('betterAuth({')
  })

  it.each(authApps)('%s wires the required production client-IP boundary', (app) => {
    expect(read(`${app}/nuxt.config.ts`)).toContain(
      'trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER',
    )
  })

  it.each(authEnvExamples)('%s leaves copyable secrets and the ingress header blank', (path) => {
    const source = read(path)

    expect(source).not.toMatch(/^BETTER_AUTH_SECRETS=/mu)
    expect(source).toMatch(/^BCN_AUTH_PROXY_IP_SECRET=$/mu)
    expect(source).toMatch(/^BCN_AUTH_TRUSTED_CLIENT_IP_HEADER=$/mu)
  })
})
