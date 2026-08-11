/** Generated Convex server utilities. */
import {
  actionGeneric,
  httpActionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
  type ActionBuilder,
  type GenericActionCtx,
  type GenericDatabaseReader,
  type GenericDatabaseWriter,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type HttpActionBuilder,
  type MutationBuilder,
  type QueryBuilder,
} from 'convex/server'
import type { DataModel } from './dataModel.js'

export const query: QueryBuilder<DataModel, 'public'> = queryGeneric
export const internalQuery: QueryBuilder<DataModel, 'internal'> = internalQueryGeneric
export const mutation: MutationBuilder<DataModel, 'public'> = mutationGeneric
export const internalMutation: MutationBuilder<DataModel, 'internal'> = internalMutationGeneric
export const action: ActionBuilder<DataModel, 'public'> = actionGeneric
export const internalAction: ActionBuilder<DataModel, 'internal'> = internalActionGeneric
export const httpAction: HttpActionBuilder = httpActionGeneric

export type QueryCtx = GenericQueryCtx<DataModel>
export type MutationCtx = GenericMutationCtx<DataModel>
export type ActionCtx = GenericActionCtx<DataModel>
export type DatabaseReader = GenericDatabaseReader<DataModel>
export type DatabaseWriter = GenericDatabaseWriter<DataModel>
