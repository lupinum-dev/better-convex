/// <reference types="vite/client" />

import type { BetterAuthDBSchema, DBFieldAttribute } from 'better-auth/db'
import { describe, expect, it, vi } from 'vitest'

import agenticSchema from '../../internal/labs/agentic-saas/convex/betterAuth/schema'
import agenticSchemaMetadata from '../../internal/labs/agentic-saas/convex/betterAuth/schemaMetadata'
import rootPackage from '../../package.json'
import lockfile from '../../pnpm-lock.yaml?raw'
import adapterProvenance from '../../security/upstream-convex-better-auth.json'
import { createConvexAuthAdapter } from '../../src/runtime/convex-auth/adapter/create-adapter'
import {
  createAuthSchema,
  generateAuthSchemaArtifacts,
} from '../../src/runtime/convex-auth/adapter/generate-schema'
import {
  assertAuthSchemaMatchesMetadata,
  type AuthSchemaMetadata,
} from '../../src/runtime/convex-auth/adapter/metadata'
import {
  matchesAuthWhere,
  toBetterAuthDocument,
  validateAuthReadArgs,
} from '../../src/runtime/convex-auth/adapter/query'
import packagedSchema from '../../src/runtime/convex-auth/component/schema'
import packagedSchemaMetadata from '../../src/runtime/convex-auth/component/schemaMetadata'
import { requireWritableAuthCtx } from '../../src/runtime/convex-auth/context'
import teamSchema from '../../starters/team/convex/betterAuth/schema'
import teamSchemaMetadata from '../../starters/team/convex/betterAuth/schemaMetadata'

const tables = {
  user: {
    modelName: 'authUser',
    fields: {
      email: { type: 'string', required: true, unique: true },
    },
  },
  session: {
    modelName: 'authSession',
    fields: {
      token: { type: 'string', required: true, unique: true },
      userId: {
        type: 'string',
        required: true,
        references: { model: 'authUser', field: 'id', onDelete: 'cascade' },
      },
      expiresAt: { type: 'date', required: true },
      label: { type: 'string', fieldName: 'displayLabel', sortable: true },
    },
  },
} as unknown as BetterAuthDBSchema

const verificationTables = {
  verification: {
    modelName: 'verification',
    fields: {
      identifier: { type: 'string', required: true },
      value: { type: 'string', required: true },
      expiresAt: { type: 'date', required: true },
      createdAt: { type: 'date', required: true },
      updatedAt: { type: 'date', required: true },
    },
  },
} as unknown as BetterAuthDBSchema

describe('pinned Better Auth adapter contract provenance', () => {
  it('pins the exact npm artifacts, upstream tests, and intentional adaptations', () => {
    const contract = adapterProvenance.adapterContractTests

    expect(contract.upstreamCommit).toMatch(/^[0-9a-f]{40}$/u)
    expect(contract.upstreamTag).toBe('v1.7.0-rc.2')
    expect(contract.sourceTestPaths).toEqual(
      expect.arrayContaining([
        'packages/core/src/db/adapter/factory.test.ts',
        'packages/core/src/db/adapter/get-id-field.test.ts',
        'packages/test-utils/src/adapter/suites/basic.ts',
        'packages/test-utils/src/adapter/suites/case-insensitive.ts',
        'packages/kysely-adapter/src/increment-one.test.ts',
      ]),
    )
    expect(contract.intentionalAdaptations).toHaveLength(4)

    for (const artifact of contract.npmArtifacts) {
      const declared =
        rootPackage.dependencies?.[artifact.name as keyof typeof rootPackage.dependencies] ??
        rootPackage.devDependencies?.[artifact.name as keyof typeof rootPackage.devDependencies]
      expect(declared).toBe(artifact.version)
      expect(lockfile).toContain(artifact.integrity)
      expect(artifact.typePaths.length).toBeGreaterThan(0)
    }
  })
})

describe('greenfield Convex auth schema generation', () => {
  it('preserves a first-class logical id and emits canonical null fields', () => {
    const artifacts = generateAuthSchemaArtifacts(tables)
    const session = artifacts.metadata.models.authSession

    expect(session).toBeDefined()
    expect(session?.fields.id).toMatchObject({
      logicalName: 'id',
      physicalName: 'id',
      nullable: false,
      required: true,
      unique: true,
      updatable: false,
    })
    expect(session?.fields.displayLabel).toMatchObject({
      logicalName: 'label',
      physicalName: 'displayLabel',
      nullable: true,
      sortable: true,
    })
    expect(artifacts.schemaCode).toContain('id: v.string()')
    expect(artifacts.schemaCode).toContain('displayLabel: v.union(v.null(), v.string())')
    expect(artifacts.schemaCode).not.toContain('v.optional')
  })

  it('keeps declared compound-index order and emits deterministic artifacts', () => {
    const first = generateAuthSchemaArtifacts(tables)
    const second = generateAuthSchemaArtifacts(tables)
    const indexes = first.metadata.models.authSession?.indexes

    expect(indexes).toEqual(
      expect.arrayContaining([
        { descriptor: 'id', fields: ['id'], unique: true },
        { descriptor: 'expiresAt', fields: ['expiresAt'] },
        { descriptor: 'userId_expiresAt', fields: ['userId', 'expiresAt'] },
        { descriptor: 'token', fields: ['token'], unique: true },
        { descriptor: 'userId', fields: ['userId'] },
        { descriptor: 'displayLabel', fields: ['displayLabel'] },
      ]),
    )
    expect(indexes?.find((index) => index.descriptor === 'userId_expiresAt')?.fields).toEqual([
      'userId',
      'expiresAt',
    ])
    expect(second).toEqual(first)
  })

  it('uses Better Auth table-level compound indexes as the schema authority', () => {
    const indexedTables = {
      tenantCredential: {
        modelName: 'tenantCredential',
        fields: {
          tenant: { type: 'string', fieldName: 'tenantId', required: true },
          handle: { type: 'string', required: true },
        },
        indexes: [
          {
            name: 'tenant_handle_identity',
            fields: ['tenant', 'handle'],
            unique: true,
          },
        ],
      },
    } as unknown as BetterAuthDBSchema

    expect(
      generateAuthSchemaArtifacts(indexedTables).metadata.models.tenantCredential?.indexes,
    ).toContainEqual({
      descriptor: 'tenant_handle_identity',
      fields: ['tenantId', 'handle'],
      unique: true,
    })
  })

  it('uses the RC.2 issuer-scoped account identity without an RC.1 alias', () => {
    const account = packagedSchemaMetadata.models.account

    expect(account?.fields).toHaveProperty('issuer')
    expect(account?.fields).toHaveProperty('providerAccountId')
    expect(account?.fields).not.toHaveProperty('accountId')
    expect(account?.indexes).toContainEqual({
      descriptor: 'issuer_providerAccountId',
      fields: ['issuer', 'providerAccountId'],
      unique: true,
    })
  })

  it('materializes pinned relationship targets and deletion policies', () => {
    const artifacts = generateAuthSchemaArtifacts(tables)

    expect(artifacts.metadata.models.authSession?.fields.userId?.reference).toEqual({
      model: 'authUser',
      field: 'id',
      onDelete: 'cascade',
    })

    const defaultCascade = structuredClone(tables) as unknown as BetterAuthDBSchema
    const session = defaultCascade.session
    if (!session) throw new Error('Expected session schema')
    const userId = session.fields.userId as DBFieldAttribute
    if (!userId.references) throw new Error('Expected user reference')
    delete userId.references.onDelete
    expect(
      generateAuthSchemaArtifacts(defaultCascade).metadata.models.authSession?.fields.userId
        ?.reference,
    ).toMatchObject({ onDelete: 'cascade' })
  })

  it('rejects relationship semantics Convex cannot execute exactly', () => {
    const withPolicy = (onDelete: string, required = false) =>
      ({
        user: {
          modelName: 'user',
          fields: { email: { type: 'string', required: true } },
        },
        child: {
          modelName: 'child',
          fields: {
            userId: {
              type: 'string',
              required,
              references: { model: 'user', field: 'id', onDelete },
            },
          },
        },
      }) as unknown as BetterAuthDBSchema

    expect(() => generateAuthSchemaArtifacts(withPolicy('no action'))).toThrow(
      'AUTH_SCHEMA_REFERENCE_DELETE_UNSUPPORTED:child.userId:no action',
    )
    expect(() => generateAuthSchemaArtifacts(withPolicy('set default'))).toThrow(
      'AUTH_SCHEMA_REFERENCE_DELETE_UNSUPPORTED:child.userId:set default',
    )
    expect(() => generateAuthSchemaArtifacts(withPolicy('set null', true))).toThrow(
      'AUTH_SCHEMA_REFERENCE_SET_NULL_REQUIRED:child.userId',
    )
  })

  it('emits the exact ordered verification lookup index required by final-factor MFA', () => {
    const artifacts = generateAuthSchemaArtifacts(verificationTables)

    expect(artifacts.metadata.models.verification?.indexes).toContainEqual({
      descriptor: 'createdAt',
      fields: ['createdAt'],
    })
    expect(artifacts.metadata.models.verification?.indexes).toContainEqual({
      descriptor: 'identifier_createdAt',
      fields: ['identifier', 'createdAt'],
    })
    expect(artifacts.schemaCode).toContain(
      ".index('identifier_createdAt', ['identifier', 'createdAt'])",
    )
  })

  it('keeps the runtime schema hook pure and emits self-contained paired artifacts', async () => {
    const schemaTarget = 'convex/betterAuth/schema.ts'
    const result = await createAuthSchema({ file: schemaTarget, tables })
    const artifacts = generateAuthSchemaArtifacts(tables)

    expect(result).toEqual({ code: artifacts.schemaCode, overwrite: true, path: schemaTarget })
    expect(artifacts.metadataCode).not.toContain('import type')
    expect(artifacts.metadata.fingerprint).toMatch(/^bcn-auth-schema-v2:[0-9a-f]{16}$/u)
  })

  it('rejects stale or structurally mismatched schema and metadata pairs', () => {
    expect(() =>
      assertAuthSchemaMatchesMetadata(packagedSchema, packagedSchemaMetadata),
    ).not.toThrow()

    const stale = structuredClone(packagedSchemaMetadata) as AuthSchemaMetadata
    stale.fingerprint = 'bcn-auth-schema-v2:0000000000000000'
    expect(() => assertAuthSchemaMatchesMetadata(packagedSchema, stale)).toThrow(
      'AUTH_SCHEMA_METADATA_MISMATCH',
    )

    const legacy = structuredClone(packagedSchemaMetadata) as AuthSchemaMetadata
    legacy.fingerprint = 'bcn-auth-schema-v1:2b65d1f3b73c9b46'
    const legacySchema = {
      __betterConvexNuxtAuthSchemaFingerprint: legacy.fingerprint,
      export: (packagedSchema as unknown as { export: () => string }).export.bind(packagedSchema),
    }
    expect(() => assertAuthSchemaMatchesMetadata(legacySchema, legacy)).toThrow(
      'AUTH_SCHEMA_METADATA_MISMATCH',
    )

    const mismatched = structuredClone(packagedSchemaMetadata) as AuthSchemaMetadata
    const user = mismatched.models.user
    if (!user) throw new Error('Expected generated user metadata.')
    delete (user.fields as Record<string, unknown>).name
    expect(() => assertAuthSchemaMatchesMetadata(packagedSchema, mismatched)).toThrow(
      'AUTH_SCHEMA_METADATA_MISMATCH',
    )

    const compoundUniqueTamper = structuredClone(packagedSchemaMetadata) as AuthSchemaMetadata
    const accountCompoundIndex = compoundUniqueTamper.models.account?.indexes.find(
      (index) => index.descriptor === 'issuer_providerAccountId',
    )
    if (!accountCompoundIndex) throw new Error('Expected generated account compound index.')
    delete (accountCompoundIndex as { unique?: true }).unique
    expect(() => assertAuthSchemaMatchesMetadata(packagedSchema, compoundUniqueTamper)).toThrow(
      'AUTH_SCHEMA_METADATA_MISMATCH',
    )
  })

  it('keeps every maintained local component paired with its generated metadata', () => {
    expect(() =>
      assertAuthSchemaMatchesMetadata(agenticSchema, agenticSchemaMetadata),
    ).not.toThrow()
    expect(() => assertAuthSchemaMatchesMetadata(teamSchema, teamSchemaMetadata)).not.toThrow()
  })

  it('generates the organization indexes used by live authorization and invitation paging', () => {
    expect(agenticSchemaMetadata.models.member?.indexes).toContainEqual({
      descriptor: 'organizationId_userId',
      fields: ['organizationId', 'userId'],
      unique: true,
    })
    expect(teamSchemaMetadata.models.teamMember?.indexes).toContainEqual({
      descriptor: 'teamId_userId',
      fields: ['teamId', 'userId'],
      unique: true,
    })
    expect(teamSchemaMetadata.models.invitation?.indexes).toEqual(
      expect.arrayContaining([
        {
          descriptor: 'email_organizationId_status',
          fields: ['email', 'organizationId', 'status'],
        },
        {
          descriptor: 'organizationId_status_createdAt',
          fields: ['organizationId', 'status', 'createdAt'],
        },
        { descriptor: 'createdAt', fields: ['createdAt'] },
      ]),
    )
  })

  it('marks only canonical compound identities as unique', () => {
    const accountIndexDescriptors: readonly string[] =
      packagedSchemaMetadata.models.account?.indexes.map((index) => index.descriptor) ?? []

    expect(
      packagedSchemaMetadata.models.account?.indexes.find(
        (index) => index.descriptor === 'issuer_providerAccountId',
      ),
    ).toMatchObject({ unique: true })

    expect(accountIndexDescriptors).not.toContain('providerId_userId')
    expect(
      packagedSchemaMetadata.models.oauthConsent?.indexes.find(
        (index) => index.descriptor === 'clientId_userId',
      ),
    ).toEqual({ descriptor: 'clientId_userId', fields: ['clientId', 'userId'] })
    expect(
      teamSchemaMetadata.models.invitation?.indexes.find(
        (index) => index.descriptor === 'email_organizationId_status',
      ),
    ).toEqual({
      descriptor: 'email_organizationId_status',
      fields: ['email', 'organizationId', 'status'],
    })
  })
})

describe('greenfield Convex auth query invariants', () => {
  it('strips Convex storage identity while preserving logical identity and selection', () => {
    const stored = {
      _id: 'storage-id',
      _creationTime: 123,
      id: 'logical-id',
      email: 'ada@example.com',
    }

    expect(toBetterAuthDocument(stored)).toEqual({
      id: 'logical-id',
      email: 'ada@example.com',
    })
    expect(toBetterAuthDocument(stored, ['id'])).toEqual({ id: 'logical-id' })
  })

  it('evaluates mixed AND/OR connectors in order and supports canonical null filters', () => {
    const where = [
      { field: 'tenant', value: 'acme' },
      { field: 'active', value: true, connector: 'AND' as const },
      { field: 'role', value: 'owner', connector: 'OR' as const },
    ]

    expect(matchesAuthWhere({ tenant: 'acme', active: true, role: 'member' }, where)).toBe(true)
    expect(matchesAuthWhere({ tenant: 'other', active: false, role: 'owner' }, where)).toBe(true)
    expect(matchesAuthWhere({ tenant: 'acme', active: false, role: 'member' }, where)).toBe(false)
    expect(matchesAuthWhere({ image: null }, [{ field: 'image', value: null }])).toBe(true)
    expect(matchesAuthWhere({}, [{ field: 'image', value: null }])).toBe(true)
  })

  it('supports case-insensitive string and array filters', () => {
    expect(
      matchesAuthWhere({ name: 'Ada Lovelace', role: 'OWNER' }, [
        {
          field: 'name',
          operator: 'contains',
          value: 'LOVELACE',
          mode: 'insensitive',
        },
        {
          field: 'role',
          operator: 'in',
          value: ['owner', 'admin'],
          mode: 'insensitive',
        },
      ]),
    ).toBe(true)
  })

  it('rejects unsupported sort and malformed indexed-filter inputs', () => {
    const metadata = generateAuthSchemaArtifacts(tables).metadata

    expect(() =>
      validateAuthReadArgs(metadata, {
        model: 'authSession',
        sortBy: { field: 'displayLabel', direction: 'asc' },
      }),
    ).not.toThrow()
    expect(() =>
      validateAuthReadArgs(metadata, {
        model: 'authSession',
        sortBy: { field: 'userId', direction: 'asc' },
      }),
    ).toThrow('AUTH_FIELD_NOT_SORTABLE:authSession.userId')
    expect(() =>
      validateAuthReadArgs(metadata, {
        model: 'authSession',
        where: [{ field: 'userId', operator: 'in', value: 'not-an-array' }],
      }),
    ).toThrow('AUTH_ARRAY_OPERATOR_REQUIRES_ARRAY:authSession.userId')
  })
})

describe('greenfield Convex auth write contexts', () => {
  it('rejects writes from a query-only context before transport is invoked', () => {
    const queryCtx = {
      db: {},
      auth: {},
      runQuery: async () => null,
    }

    expect(() => requireWritableAuthCtx(queryCtx as never)).toThrow(
      'AUTH_WRITE_REQUIRES_MUTATION_OR_ACTION',
    )
  })

  it('accepts a mutation/action context that exposes runMutation', () => {
    const writableCtx = {
      db: {},
      auth: {},
      runQuery: async () => null,
      runMutation: async () => null,
    }

    expect(() => requireWritableAuthCtx(writableCtx as never)).not.toThrow()
  })

  it('rejects a write through the Better Auth adapter when invoked from a query', async () => {
    const queryCtx = {
      db: {},
      auth: {},
      runQuery: async () => null,
    }
    const component = { adapter: { create: {} } }
    const adapter = createConvexAuthAdapter(queryCtx as never, component as never)({} as never)

    await expect(
      adapter.create({
        model: 'user',
        data: { id: 'query_write_forbidden', name: 'Ada' },
        forceAllowId: true,
      }),
    ).rejects.toThrow('AUTH_WRITE_REQUIRES_MUTATION_OR_ACTION')
  })

  it('preserves forced logical ids through the pinned Better Auth adapter factory', async () => {
    let componentInput: Record<string, unknown> | undefined
    const createReference = { operation: 'create' }
    const ctx = {
      db: {},
      auth: {},
      runQuery: vi.fn(),
      runMutation: vi.fn(async (_reference, args: { data: Record<string, unknown> }) => {
        componentInput = args.data
        return args.data
      }),
    }
    const component = { adapter: { create: createReference } }
    const adapter = createConvexAuthAdapter(
      ctx as never,
      component as never,
    )({
      user: { fields: { email: 'email_address' } },
    } as never)
    const create = adapter.create as (args: {
      data: Record<string, unknown>
      forceAllowId: boolean
      model: string
    }) => Promise<Record<string, unknown>>

    const created = await create({
      model: 'user',
      forceAllowId: true,
      data: {
        id: 'forced_logical_user',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true,
        image: null,
        createdAt: new Date(100),
        updatedAt: new Date(200),
      },
    })

    expect(ctx.runMutation).toHaveBeenCalledWith(createReference, expect.any(Object))
    expect(componentInput).toMatchObject({
      id: 'forced_logical_user',
      email_address: 'ada@example.com',
      createdAt: 100,
      updatedAt: 200,
    })
    expect(componentInput).not.toHaveProperty('email')
    expect(created).toMatchObject({
      id: 'forced_logical_user',
      email: 'ada@example.com',
      createdAt: new Date(100),
      updatedAt: new Date(200),
    })
  })

  it('maps configured relationship trigger models once at the adapter boundary', async () => {
    const componentCalls: Array<{ args: Record<string, unknown>; reference: unknown }> = []
    const deleteOneReference = { operation: 'deleteOne' }
    const ctx = {
      auth: {},
      db: {},
      runQuery: vi.fn(),
      runMutation: vi.fn(async (reference, args: Record<string, unknown>) => {
        componentCalls.push({ args, reference })
        return null
      }),
    }
    const component = { adapter: { deleteOne: deleteOneReference } }
    const adapter = createConvexAuthAdapter(ctx as never, component as never, {
      triggers: {
        user: {
          onDelete: async () => {},
        },
      },
    })({
      user: { modelName: 'people' },
    } as never)

    await adapter.delete({
      model: 'user',
      where: [{ field: 'id', value: 'user-1' }],
    })

    expect(componentCalls).toEqual([
      {
        reference: deleteOneReference,
        args: expect.objectContaining({
          model: 'people',
          onDeleteModels: ['people'],
          onUpdateModels: [],
        }),
      },
    ])
  })

  it('maps logical filters once and delegates count to the component snapshot query', async () => {
    const findManyReference = { operation: 'findMany' }
    const countReference = { operation: 'count' }
    const componentCalls: Array<{ args: Record<string, unknown>; reference: unknown }> = []
    const ctx = {
      db: {},
      auth: {},
      runMutation: vi.fn(),
      runQuery: vi.fn(async (reference, args: Record<string, unknown>) => {
        componentCalls.push({ reference, args })
        if (reference === countReference) return 205
        return { continueCursor: '', isDone: true, page: [] }
      }),
    }
    const component = {
      adapter: { count: countReference, findMany: findManyReference },
    }
    const adapter = createConvexAuthAdapter(
      ctx as never,
      component as never,
    )({
      user: { fields: { email: 'email_address' } },
    } as never)
    const where = [{ field: 'email', value: 'ada@example.com' }]

    await adapter.findMany({ model: 'user', where })
    await expect(adapter.count({ model: 'user', where })).resolves.toBe(205)

    expect(componentCalls).toHaveLength(2)
    expect(componentCalls[0]).toMatchObject({
      reference: findManyReference,
      args: { model: 'user', where: [{ field: 'email_address', value: 'ada@example.com' }] },
    })
    expect(componentCalls[1]).toMatchObject({
      reference: countReference,
      args: {
        model: 'user',
        where: [{ field: 'email_address', value: 'ada@example.com' }],
      },
    })
  })

  it('maps logical create, find, select, and sort fields once before the component', async () => {
    const createReference = { operation: 'create' }
    const findOneReference = { operation: 'findOne' }
    const findManyReference = { operation: 'findMany' }
    const componentCalls: Array<{ args: Record<string, unknown>; reference: unknown }> = []
    const physicalRows = [
      {
        id: 'user-ada',
        name: 'Ada',
        email_address: 'ada@example.com',
        emailVerified: true,
        image: null,
        createdAt: 100,
        updatedAt: 200,
      },
      {
        id: 'user-grace',
        name: 'Grace',
        email_address: 'grace@example.com',
        emailVerified: true,
        image: null,
        createdAt: 300,
        updatedAt: 400,
      },
    ]
    const ctx = {
      db: {},
      auth: {},
      runMutation: vi.fn(async (reference, args: Record<string, unknown>) => {
        componentCalls.push({ reference, args })
        return args.data
      }),
      runQuery: vi.fn(async (reference, args: Record<string, unknown>) => {
        componentCalls.push({ reference, args })
        if (reference === findOneReference) return physicalRows[0]
        return { continueCursor: '', isDone: true, page: physicalRows }
      }),
    }
    const component = {
      adapter: {
        create: createReference,
        findMany: findManyReference,
        findOne: findOneReference,
      },
    }
    const adapter = createConvexAuthAdapter(
      ctx as never,
      component as never,
    )({
      user: { fields: { email: 'email_address' } },
    } as never)

    const created = await adapter.create({
      model: 'user',
      forceAllowId: true,
      select: ['email'],
      data: {
        id: 'user-ada',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true,
        image: null,
        createdAt: new Date(100),
        updatedAt: new Date(200),
      },
    })
    const found = await adapter.findOne({
      model: 'user',
      select: ['email'],
      where: [{ field: 'email', value: 'ada@example.com' }],
    })
    const many = (await adapter.findMany({
      limit: 10,
      model: 'user',
      select: ['email'],
      sortBy: { direction: 'asc', field: 'email' },
      where: [{ field: 'email', operator: 'in', value: ['ada@example.com', 'grace@example.com'] }],
    })) as Array<Record<string, unknown>>

    expect(created).toEqual({ email: 'ada@example.com' })
    expect(found).toEqual({ email: 'ada@example.com' })
    expect(many.map((row) => row.email)).toEqual(['ada@example.com', 'grace@example.com'])
    expect(many.every((row) => !Object.hasOwn(row, 'email_address'))).toBe(true)
    expect(componentCalls).toHaveLength(3)
    expect(componentCalls[0]).toMatchObject({
      reference: createReference,
      args: { data: { email_address: 'ada@example.com' }, model: 'user' },
    })
    expect(componentCalls[0]!.args).not.toHaveProperty('select')
    expect(componentCalls[1]).toMatchObject({
      reference: findOneReference,
      args: {
        model: 'user',
        select: ['email_address'],
        where: [{ field: 'email_address', value: 'ada@example.com' }],
      },
    })
    expect(componentCalls[2]).toMatchObject({
      reference: findManyReference,
      args: {
        model: 'user',
        select: ['email_address'],
        sortBy: { direction: 'asc', field: 'email_address' },
        where: [
          {
            field: 'email_address',
            operator: 'in',
            value: ['ada@example.com', 'grace@example.com'],
          },
        ],
      },
    })

    await expect(
      adapter.findOne({
        model: 'user',
        select: ['notAField'],
        where: [{ field: 'email', value: 'ada@example.com' }],
      }),
    ).rejects.toThrow('Field notAField not found in model user')
    await expect(
      adapter.findMany({
        limit: 1,
        model: 'user',
        sortBy: { direction: 'asc', field: 'notAField' },
      }),
    ).rejects.toThrow('Field notAField not found in model user')
    expect(componentCalls).toHaveLength(3)
  })
})

// Compile-time guard: metadata remains serializable data, not schema runtime state.
const _metadataContract: AuthSchemaMetadata = generateAuthSchemaArtifacts(tables).metadata
void _metadataContract
