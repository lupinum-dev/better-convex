import { testUtils, type TestHelpers } from 'better-auth/plugins'
/*
 * Adapted from get-convex/better-auth at
 * c628916b451a6b4cff0f5464f134475464b1a6da (Apache-2.0).
 */
import {
  componentsGeneric,
  type FunctionReference,
  type GenericDataModel,
  type GenericSchema,
  type SchemaDefinition,
  type UserIdentity,
} from 'convex/server'

import type { ComponentApi } from './component/_generated/component'
import schema from './component/schema'
import {
  createBetterConvexAuthOwned,
  type BetterConvexAuth,
  type BetterConvexAuthInstance,
  type CreateBetterConvexAuthOptions,
} from './create-better-convex-auth'
import type { BetterConvexMcpPrincipal } from './mcp-principal'
import { canonicalAuthIssuer, resolveMcpResource } from './mcp-profile'
import type { AuthAdapterComponentApi } from './types'

type ComponentModules = Record<string, () => Promise<unknown>>

interface ComponentRegistrar {
  registerComponent(
    name: string,
    schema: SchemaDefinition<GenericSchema, boolean>,
    modules: ComponentModules,
  ): void
}

interface BetterAuthTestHelper {
  modules: ComponentModules
  register: typeof register
  schema: SchemaDefinition<GenericSchema, boolean>
}

export interface BetterConvexTestAuthInstance extends BetterConvexAuthInstance {
  readonly $context: Promise<{ readonly test: TestHelpers } & Record<string, unknown>>
}

function requireLoopbackOrigin(name: 'CONVEX_SITE_URL' | 'SITE_URL'): void {
  const value = process.env[name]
  if (!value) throw new Error('AUTH_TEST_LOOPBACK_REQUIRED')
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('AUTH_TEST_LOOPBACK_REQUIRED')
    }
  } catch {
    throw new Error('AUTH_TEST_LOOPBACK_REQUIRED')
  }
}

/**
 * The session and grant helpers write auth rows without the sign-in or consent flow: they run
 * only under a test runner (Vitest sets `VITEST`, test runners `NODE_ENV=test`), never in a
 * deployment, where neither is set.
 */
function requireTestRunner(): void {
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    throw new Error('AUTH_TEST_RUNNER_REQUIRED')
  }
}

function requireLoopbackOrigins(): void {
  requireLoopbackOrigin('SITE_URL')
  requireLoopbackOrigin('CONVEX_SITE_URL')
}

/**
 * Create the normal Better Convex auth unit with Better Auth's test helpers.
 * This entry refuses non-loopback runtimes and offers no arbitrary plugin seam.
 */
export function createBetterConvexTestAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(
  component: Api,
  options: CreateBetterConvexAuthOptions<DataModel>,
): BetterConvexAuth<DataModel, BetterConvexTestAuthInstance> {
  requireLoopbackOrigins()
  return createBetterConvexAuthOwned<DataModel, Api>(
    component,
    options,
    [testUtils()],
    requireLoopbackOrigins,
  ) as unknown as BetterConvexAuth<DataModel, BetterConvexTestAuthInstance>
}

// Keep this map static so the compiled npm entry works in plain Node as well
// as under Vite. The generated key establishes convex-test's component root;
// adapter is the only component function module.
const modules: ComponentModules = {
  './component/_generated/api.js': () => import('./component/_generated/api.js'),
  './component/adapter.js': () => import('./component/adapter.js'),
}

export function register(test: ComponentRegistrar, name = 'betterAuth'): void {
  test.registerComponent(name, schema, modules)
}

/** The part of a `convex-test` instance that {@link signInAs} uses. */
export interface SignInAsTestClient<Client> {
  query(reference: FunctionReference<'query', 'internal'>, args: object): Promise<unknown>
  mutation(reference: FunctionReference<'mutation', 'internal'>, args: object): Promise<unknown>
  withIdentity(identity: Partial<UserIdentity>): Client
}

export interface SignInAsOptions {
  /** Component name passed to {@link register}. Defaults to `betterAuth`. */
  readonly componentName?: string
  /** Session lifetime from now, in milliseconds. Defaults to one hour. */
  readonly expiresInMs?: number
}

type Adapter = ComponentApi['adapter']

function adapterOf(componentName = 'betterAuth'): Adapter {
  return (componentsGeneric() as unknown as Record<string, ComponentApi>)[componentName]!.adapter
}

/**
 * The person behind {@link signInAs} and {@link grantMcp}: the user `subject`
 * and its session `<subject>-session`. Both helpers reuse what exists, so they
 * work together in any order. When the user exists but that session was
 * deleted (a sign-out), a new session gets a fresh ID.
 */
async function ensureSession(
  test: SignInAsTestClient<unknown>,
  adapter: Adapter,
  subject: string,
  lifetime: number,
): Promise<string> {
  let sessionId = `${subject}-session`
  const now = Date.now()
  const find = (model: 'user' | 'session', id: string) =>
    test.query(adapter.findOne, { model, where: [{ field: 'id', value: id }] })

  const existingUser = await find('user', subject)
  if (!existingUser) {
    await test.mutation(adapter.create, {
      model: 'user',
      data: {
        id: subject,
        name: subject,
        email: `${subject}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    })
  }
  if (!(await find('session', sessionId))) {
    if (existingUser) sessionId = `${subject}-session-${crypto.randomUUID()}`
    await test.mutation(adapter.create, {
      model: 'session',
      data: {
        id: sessionId,
        userId: subject,
        token: `${sessionId}-token`,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + lifetime,
      },
    })
  }
  return sessionId
}

/**
 * Return a `convex-test` client that calls functions as a live Better Auth
 * session for `subject`, so `auth.getUser`/`auth.requireUser` admit it. The
 * user (ID `subject`, `<subject>@example.com`, verified) and its session
 * (ID `<subject>-session`) are created through the component adapter on first
 * use. The identity carries exactly the claims the library's session admission
 * reads; tests never hand-write them.
 */
export async function signInAs<Client>(
  test: SignInAsTestClient<Client>,
  subject: string,
  options: SignInAsOptions = {},
): Promise<Client> {
  requireTestRunner()
  const lifetime = options.expiresInMs ?? 60 * 60 * 1000
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0) {
    throw new RangeError('AUTH_TEST_SESSION_LIFETIME_INVALID')
  }
  const sessionId = await ensureSession(test, adapterOf(options.componentName), subject, lifetime)
  return test.withIdentity({ subject, sid: sessionId, token_use: 'convex-session' })
}

export interface GrantMcpOptions {
  /** OAuth client ID of the host. Defaults to `test-host`. */
  readonly clientId?: string
  /**
   * The MCP resource, as `oauth.mcp.resource` takes it: a path on
   * `CONVEX_SITE_URL` or an absolute URL. Defaults to `/mcp`.
   */
  readonly resource?: string
  /** Component name passed to {@link register}. Defaults to `betterAuth`. */
  readonly componentName?: string
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/**
 * Give `subject` a live MCP grant: the host client, the resource, the link
 * between them, and the person's consent to `scopes`, created through the
 * component adapter. Returns the principal that the MCP door passes to a tool
 * after it verifies an access token, for
 * `t.mutation(anyApi.agents.<tool>, { caller: { door: 'mcp', principal }, input })`.
 *
 * The grant belongs to the same user and session as {@link signInAs}, in any
 * order, so deleting that session (a sign-out) also ends the grant. Calling it
 * again for the same person and client adds scopes to the consent. The
 * principal's `issuer` comes from `SITE_URL`; the access token it stands for
 * expires in ten minutes.
 */
export async function grantMcp<Client>(
  test: SignInAsTestClient<Client>,
  subject: string,
  scopes: readonly string[],
  options: GrantMcpOptions = {},
): Promise<BetterConvexMcpPrincipal> {
  requireTestRunner()
  if (
    scopes.length === 0 ||
    scopes.some((scope) => typeof scope !== 'string' || scope.length === 0)
  ) {
    throw new RangeError('AUTH_TEST_MCP_SCOPES_INVALID')
  }
  const adapter = adapterOf(options.componentName)
  const clientId = options.clientId ?? 'test-host'
  const resource = resolveMcpResource({ resource: options.resource ?? '/mcp' }).href
  const issuer = canonicalAuthIssuer()
  const sessionId = await ensureSession(test, adapter, subject, 60 * 60 * 1000)
  const now = Date.now()
  const findOne = (model: string, where: Record<string, string>) =>
    test.query(adapter.findOne, {
      model,
      where: Object.entries(where).map(([field, value]) => ({ field, value })),
    }) as Promise<Record<string, unknown> | null>
  const create = (model: string, data: Record<string, unknown>) =>
    test.mutation(adapter.create, { model, data })
  const widen = async (model: string, where: Record<string, string>, update: object) =>
    test.mutation(adapter.updateOne, {
      model,
      where: Object.entries(where).map(([field, value]) => ({ field, value })),
      update,
    })
  const missing = (have: unknown, want: readonly string[]) =>
    want.some((value) => !(Array.isArray(have) && have.includes(value)))

  if (!(await findOne('oauthResource', { identifier: resource }))) {
    await create('oauthResource', {
      id: `resource-${crypto.randomUUID()}`,
      identifier: resource,
      name: 'MCP resource',
      allowedScopes: null,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    })
  }
  const client = await findOne('oauthClient', { clientId })
  if (!client) {
    await create('oauthClient', {
      id: `client-${crypto.randomUUID()}`,
      clientId,
      name: clientId,
      disabled: false,
      redirectUris: ['http://127.0.0.1/callback'],
      scopes: unique(scopes),
      createdAt: now,
      updatedAt: now,
    })
  } else if (missing(client.scopes, scopes)) {
    await widen(
      'oauthClient',
      { clientId },
      { scopes: unique([...((client.scopes as string[] | null) ?? []), ...scopes]) },
    )
  }
  if (!(await findOne('oauthClientResource', { clientId, resourceId: resource }))) {
    await create('oauthClientResource', {
      id: `link-${crypto.randomUUID()}`,
      clientId,
      resourceId: resource,
      createdAt: now,
    })
  }
  const where = { clientId, userId: subject }
  const consent = await findOne('oauthConsent', where)
  const grantId = (consent?.id as string | undefined) ?? `${subject}-${clientId}-consent`
  if (!consent) {
    await create('oauthConsent', {
      id: grantId,
      clientId,
      userId: subject,
      resources: [resource],
      scopes: unique(scopes),
      createdAt: now,
      updatedAt: now,
    })
  } else if (missing(consent.scopes, scopes) || missing(consent.resources, [resource])) {
    await widen('oauthConsent', where, {
      scopes: unique([...(consent.scopes as string[]), ...scopes]),
      resources: unique([...((consent.resources as string[] | null) ?? []), resource]),
      updatedAt: now,
    })
  }
  return {
    kind: 'oauth',
    userId: subject,
    clientId,
    scopes: unique(scopes),
    sessionId,
    grantId,
    issuer,
    resource,
    expiresAt: Math.floor(now / 1000) + 600,
  }
}

const testHelper: BetterAuthTestHelper = { modules, register, schema }

export default testHelper
