/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `pnpm exec better-convex convex codegen --component-dir src/runtime/convex-auth/component`.
 * @module
 */

import type { FunctionReference, PaginationOptions, PaginationResult } from 'convex/server'

type AuthValue = string | number | boolean | string[] | number[] | null
type AuthWhere = {
  connector?: 'AND' | 'OR'
  field: string
  mode?: 'sensitive' | 'insensitive'
  operator?:
    | 'lt'
    | 'lte'
    | 'gt'
    | 'gte'
    | 'eq'
    | 'in'
    | 'not_in'
    | 'ne'
    | 'contains'
    | 'starts_with'
    | 'ends_with'
  value: AuthValue
}
type AuthDocument = Record<string, AuthValue>
type TriggerArgs = { onCreateHandle?: string; onDeleteHandle?: string; onUpdateHandle?: string }
type SigningKeyCandidate = {
  alg: 'RS256'
  crv: null
  id: string
  privateKey: string
  publicKey: string
}
type SigningKeyRotationMetadata = {
  created?: boolean
  createdAt: number
  newKid: string
  previousKids: string[]
  previousVerifyUntil: number
  rotatedAt: number
}

/** A utility for accepting the mounted Better Convex Nuxt auth component. */
export type ComponentApi<Name extends string | undefined = string | undefined> = {
  adapter: {
    consumeOne: FunctionReference<
      'mutation',
      'internal',
      {
        model: string
        where: AuthWhere[]
        onDeleteHandle?: string
        onDeleteModels?: string[]
        onUpdateHandle?: string
        onUpdateModels?: string[]
      },
      AuthDocument | null,
      Name
    >
    count: FunctionReference<
      'query',
      'internal',
      { model: string; where?: AuthWhere[] },
      number,
      Name
    >
    create: FunctionReference<
      'mutation',
      'internal',
      { data: Record<string, unknown>; model: string } & TriggerArgs,
      AuthDocument,
      Name
    >
    deleteMany: FunctionReference<
      'mutation',
      'internal',
      {
        model: string
        where: AuthWhere[]
        onDeleteHandle?: string
        onDeleteModels?: string[]
        onUpdateHandle?: string
        onUpdateModels?: string[]
      },
      number,
      Name
    >
    deleteOne: FunctionReference<
      'mutation',
      'internal',
      {
        model: string
        where: AuthWhere[]
        onDeleteHandle?: string
        onDeleteModels?: string[]
        onUpdateHandle?: string
        onUpdateModels?: string[]
      },
      AuthDocument | null,
      Name
    >
    findMany: FunctionReference<
      'query',
      'internal',
      {
        join?: unknown
        limit?: number
        model: string
        offset?: number
        paginationOpts: PaginationOptions
        select?: string[]
        sortBy?: { direction: 'asc' | 'desc'; field: string }
        where?: AuthWhere[]
      },
      PaginationResult<AuthDocument>,
      Name
    >
    findOne: FunctionReference<
      'query',
      'internal',
      { join?: unknown; model: string; select?: string[]; where?: AuthWhere[] },
      AuthDocument | null,
      Name
    >
    incrementOne: FunctionReference<
      'mutation',
      'internal',
      {
        increment: Record<string, number>
        model: string
        onUpdateHandle?: string
        set?: Record<string, unknown>
        where: AuthWhere[]
      },
      AuthDocument | null,
      Name
    >
    rotateSigningKey: FunctionReference<
      'mutation',
      'internal',
      { next: SigningKeyCandidate; onlyIfEmpty?: boolean },
      SigningKeyRotationMetadata,
      Name
    >
    updateMany: FunctionReference<
      'mutation',
      'internal',
      { model: string; onUpdateHandle?: string; update: Record<string, unknown>; where: AuthWhere[] },
      number,
      Name
    >
    updateOne: FunctionReference<
      'mutation',
      'internal',
      { model: string; onUpdateHandle?: string; update: Record<string, unknown>; where: AuthWhere[] },
      AuthDocument | null,
      Name
    >
  }
}
