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

/**
 * Return a `convex-test` client that calls functions as a live Better Auth
 * session for `subject`, so `auth.getUser`/`auth.requireUser` admit it. The
 * user (`<subject>@example.com`, verified) and its session are created through
 * the component adapter on first use. The identity carries exactly the claims
 * the library's session admission reads; tests never hand-write them.
 */
export async function signInAs<Client>(
  test: SignInAsTestClient<Client>,
  subject: string,
  options: SignInAsOptions = {},
): Promise<Client> {
  const lifetime = options.expiresInMs ?? 60 * 60 * 1000
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0) {
    throw new RangeError('AUTH_TEST_SESSION_LIFETIME_INVALID')
  }
  const name = options.componentName ?? 'betterAuth'
  const { adapter } = (componentsGeneric() as unknown as Record<string, ComponentApi>)[name]!
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
  return test.withIdentity({ subject, sid: sessionId, token_use: 'convex-session' })
}

const testHelper: BetterAuthTestHelper = { modules, register, schema }

export default testHelper
