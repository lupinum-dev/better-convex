/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { OAuthLiveAccess } from '../../src/runtime/convex-auth/oauth-live-access'
import rootSchema from '../fixtures/auth-relationships-root/convex/schema'

const rootModules = import.meta.glob('../fixtures/auth-relationships-root/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const components = componentsGeneric() as unknown as {
  relationshipAuth: ComponentApi<'relationshipAuth'>
}
const auth = components.relationshipAuth.adapter
const validateOAuthAccess = makeFunctionReference<'query', { access: OAuthLiveAccess }, boolean>(
  'relationshipHarness:validateOAuthAccess',
)

const now = 1_700_000_000_000
const access = Object.freeze({
  clientId: 'oauth-client',
  issuer: 'https://accounts.example.test/api/auth',
  resource: 'https://deployment.example.test/mcp',
  scopes: Object.freeze(['mcp:read', 'mcp:write']),
  sessionId: 'oauth-session',
  subject: 'oauth-user',
}) satisfies OAuthLiveAccess

function initTest() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('relationshipAuth', authSchema, authModules)
  return test
}

async function createRow(
  test: ReturnType<typeof initTest>,
  model: string,
  data: Record<string, unknown>,
) {
  await test.mutation(auth.create, { data, model })
}

async function createLiveGrant(test: ReturnType<typeof initTest>): Promise<void> {
  await createRow(test, 'user', {
    createdAt: now,
    email: 'oauth-user@example.test',
    emailVerified: true,
    id: access.subject,
    name: 'OAuth user',
    updatedAt: now,
  })
  await createRow(test, 'session', {
    createdAt: now,
    expiresAt: now + 60_000,
    id: access.sessionId,
    token: 'session-token',
    updatedAt: now,
    userId: access.subject,
  })
  await createRow(test, 'oauthClient', {
    clientId: access.clientId,
    disabled: false,
    id: 'oauth-client-row',
    redirectUris: ['https://client.example.test/callback'],
    scopes: [...access.scopes],
  })
  await createRow(test, 'oauthResource', {
    allowedScopes: [...access.scopes],
    disabled: false,
    id: 'oauth-resource-row',
    identifier: access.resource,
    name: 'MCP resource',
  })
  await createRow(test, 'oauthClientResource', {
    clientId: access.clientId,
    id: 'oauth-client-resource-row',
    resourceId: access.resource,
  })
  await createRow(test, 'oauthConsent', {
    clientId: access.clientId,
    id: 'oauth-consent-row',
    resources: [access.resource],
    scopes: [...access.scopes],
    userId: access.subject,
  })
}

async function validate(test: ReturnType<typeof initTest>): Promise<boolean> {
  return await test.query(validateOAuthAccess, { access })
}

async function updateRow(
  test: ReturnType<typeof initTest>,
  model: string,
  id: string,
  update: Record<string, unknown>,
): Promise<void> {
  await test.mutation(auth.updateOne, {
    model,
    update,
    where: [{ field: 'id', value: id }],
  })
}

describe('provider-owned OAuth live access validation', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts a current grant and preserves the provider disabled-resource semantics', async () => {
    const test = initTest()
    await createLiveGrant(test)

    await expect(validate(test)).resolves.toBe(true)
    await updateRow(test, 'oauthResource', 'oauth-resource-row', { disabled: true })
    await expect(validate(test)).resolves.toBe(true)
    await test.mutation(auth.deleteOne, {
      model: 'oauthResource',
      where: [{ field: 'id', value: 'oauth-resource-row' }],
    })
    await expect(validate(test)).resolves.toBe(false)
  })

  it.each([
    ['expired session', 'session', 'oauth-session', { expiresAt: now }],
    ['disabled client', 'oauthClient', 'oauth-client-row', { disabled: true }],
    ['client scope removal', 'oauthClient', 'oauth-client-row', { scopes: ['mcp:read'] }],
    [
      'resource scope removal',
      'oauthResource',
      'oauth-resource-row',
      { allowedScopes: ['mcp:read'] },
    ],
    ['consent scope removal', 'oauthConsent', 'oauth-consent-row', { scopes: ['mcp:read'] }],
    [
      'consent resource removal',
      'oauthConsent',
      'oauth-consent-row',
      { resources: ['https://deployment.example.test/other'] },
    ],
  ] as const)('rejects %s', async (_label, model, id, update) => {
    const test = initTest()
    await createLiveGrant(test)
    await updateRow(test, model, id, update)
    await expect(validate(test)).resolves.toBe(false)
  })

  it.each([
    ['session', 'oauth-session'],
    ['user', 'oauth-user'],
    ['oauthClient', 'oauth-client-row'],
    ['oauthClientResource', 'oauth-client-resource-row'],
    ['oauthConsent', 'oauth-consent-row'],
  ] as const)('rejects a deleted %s authority row', async (model, id) => {
    const test = initTest()
    await createLiveGrant(test)
    await test.mutation(auth.deleteOne, { model, where: [{ field: 'id', value: id }] })
    await expect(validate(test)).resolves.toBe(false)
  })

  it('treats a null resource scope allowlist as unrestricted, like the provider', async () => {
    const test = initTest()
    await createLiveGrant(test)
    await updateRow(test, 'oauthResource', 'oauth-resource-row', { allowedScopes: null })
    await expect(validate(test)).resolves.toBe(true)
  })
})
